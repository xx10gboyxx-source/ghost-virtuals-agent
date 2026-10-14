import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,lstatSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {scanMemePool} from './meme-scan.mjs';
import {createBaseMemeFeed} from '../server/base-meme-feed.mjs';

export const OFFERING='ghost_base_meme_scan',FEE='0.01',RAW_FEE='10000';
const address=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x);
const id=x=>typeof x==='string'&&/^[1-9][0-9]{0,77}$/.test(x);
const zero='0x'+'0'.repeat(40);
const hash=x=>createHash('sha256').update(x).digest('hex');
const terminal=new Set(['COMPLETED','REJECTED','EXPIRED','SUBMITTED']);

// Private, bounded job journal. Records are never repurposed as trading statistics.
export class JobStore{
 constructor(path){
  path=resolve(path);mkdirSync(dirname(path),{recursive:true,mode:0o700});
  if(existsSync(path)&&(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()))throw new Error('Invalid journal path.');
  this.db=new DatabaseSync(path);chmodSync(path,0o600);
  this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS acp_jobs (key TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS acp_lease (id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT,until_ms INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS acp_identity (id INTEGER PRIMARY KEY CHECK(id=1),binding TEXT NOT NULL);
   INSERT OR IGNORE INTO acp_lease VALUES (1,NULL,0);`);
 }
 get(key){const row=this.db.prepare('SELECT payload FROM acp_jobs WHERE key=?').get(key);return row?JSON.parse(row.payload):null;}
 rows(){return this.db.prepare('SELECT payload FROM acp_jobs ORDER BY key').all().map(row=>JSON.parse(row.payload));}
 create(key,payload){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   if(!this.get(key)){
    if(this.db.prepare('SELECT count(*) n FROM acp_jobs').get().n>=2000)throw new Error('Journal capacity reached.');
    this.db.prepare('INSERT INTO acp_jobs VALUES (?,?)').run(key,JSON.stringify({...payload,key}));
   }
   this.db.exec('COMMIT');return this.get(key);
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 update(key,patch){const row=this.get(key);if(!row)return null;const next={...row,...patch};
  this.db.prepare('UPDATE acp_jobs SET payload=? WHERE key=?').run(JSON.stringify(next),key);return next;}
 // CAS persists action intent before invoking any signing command.
 reserve(key,from,to){
  const old=this.get(key);if(!old||old.state!==from)return false;
  return this.db.prepare('UPDATE acp_jobs SET payload=? WHERE key=? AND payload=?')
   .run(JSON.stringify({...old,state:to}),key,JSON.stringify(old)).changes===1;
 }
 acquire(owner,at){return this.db.prepare('UPDATE acp_lease SET owner=?,until_ms=? WHERE id=1 AND until_ms<?').run(owner,at+120000,at).changes===1;}
 renew(owner,at){return this.db.prepare('UPDATE acp_lease SET until_ms=? WHERE id=1 AND owner=? AND until_ms>?').run(at+120000,owner,at).changes===1;}
 owns(owner,at){return this.db.prepare('SELECT owner FROM acp_lease WHERE id=1 AND owner=? AND until_ms>?').get(owner,at)!==undefined;}
 release(owner){this.db.prepare('UPDATE acp_lease SET owner=NULL,until_ms=0 WHERE id=1 AND owner=?').run(owner);}
 bindIdentity(identity){
  const binding=JSON.stringify({agentId:identity.agentId,provider:identity.provider,chainId:identity.chainId});
  this.db.prepare('INSERT OR IGNORE INTO acp_identity VALUES (1,?)').run(binding);
  if(this.db.prepare('SELECT binding FROM acp_identity WHERE id=1').get().binding!==binding)throw new Error('Journal belongs to a different agent or chain.');
 }
 close(){if(this.db){this.db.close();this.db=null;}}
}

function requirements(room,job){
 if(room?.protocol!=='v2'||String(room.jobId)!==job.onChainJobId||room.chainId!==job.chainId||!Array.isArray(room.entries))return null;
 const messages=room.entries.filter(e=>e.kind==='message'&&e.contentType==='requirement');
 if(messages.length!==1)return null;
 const m=messages[0];if((m.chainId!==undefined&&m.chainId!==job.chainId)||(m.onChainJobId!==undefined&&String(m.onChainJobId)!==job.onChainJobId)||!address(m.from)||m.from.toLowerCase()!==job.clientAddress.toLowerCase()||typeof m.content!=='string'||Buffer.byteLength(m.content)>4096)return null;
 let r;try{r=JSON.parse(m.content);}catch{return null;}
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['poolAddress','strategy'].includes(k))||
  !address(r.poolAddress)||r.poolAddress.toLowerCase()===zero||
  (Object.hasOwn(r,'strategy')&&!['volume-breakout','trend-pullback'].includes(r.strategy)))return null;
 return {poolAddress:r.poolAddress.toLowerCase(),strategy:r.strategy??'volume-breakout'};
}

// Share provider budgets across every caller-selected pool, including evictions.
export function createSharedScan({now=Date.now,fetcher=globalThis.fetch,maxRequests=8}={}){
 const feeds=new Map();let requests=[],cooldownUntil=0;
 async function limitedFetch(url,options){
  const at=now();requests=requests.filter(t=>at>=t&&at-t<60000);
  if(at<cooldownUntil||requests.length>=maxRequests)throw new Error('Provider budget unavailable.');
  requests.push(at);const response=await fetcher(url,options);
  if(response.status===429){const raw=response.headers.get('retry-after'),seconds=Number(raw),date=Date.parse(raw);
   const wait=raw!==null&&Number.isFinite(seconds)&&seconds>=0?seconds*1000:Number.isFinite(date)?date-now():60000;
   cooldownUntil=Math.max(cooldownUntil,now()+Math.max(60000,wait));}
  return response;
 }
 return input=>scanMemePool(input,{now,feedFactory:({pools})=>{
  const key=pools[0];if(!feeds.has(key)){
   if(feeds.size>=32)feeds.delete(feeds.keys().next().value);
   feeds.set(key,createBaseMemeFeed({pools,fetcher:limitedFetch,now}));
  }
  return feeds.get(key);
 }});
}

export function createJobWorker({store,transport,provider,chainId=84532,now=Date.now,scan=createSharedScan({now})}){
 if(!address(provider)||provider.toLowerCase()===zero||![84532,8453].includes(chainId))throw new Error('Invalid worker identity.');
 let queue=Promise.resolve(),queued=0;
 const skipped=code=>({state:'skipped',code});
 async function processJob(job){
  const at=now();
  if(!Number.isSafeInteger(at)||at<=0||!job||job.legacy||job.chainId!==chainId||!id(job.onChainJobId)||
   !address(job.providerAddress)||job.providerAddress.toLowerCase()!==provider.toLowerCase()||!address(job.clientAddress)||
   job.description!==OFFERING||![null,undefined,zero].includes(job.hookAddress)||
   (job.intents!=null&&(!Array.isArray(job.intents)||job.intents.length))||
   (job.hookConfigs!=null&&(typeof job.hookConfigs!=='object'||Object.keys(job.hookConfigs).length))||job.clientSubscription!=null)return skipped('JOB_NOT_ALLOWED');
  const key=`${chainId}:${job.onChainJobId}`,expiry=Date.parse(job.expiredAt),record=store.get(key);
  if(terminal.has(job.jobStatus)){
   if(record)store.update(key,{state:job.jobStatus.toLowerCase(),updatedAt:at});
   return skipped('TERMINAL');
  }
  if(!['OPEN','FUNDED'].includes(job.jobStatus)||!Number.isFinite(expiry)||expiry-at<120000)return skipped('DEADLINE');
  if(record&&['review','submitted','completed','rejected','expired','deadline_passed'].includes(record.state))return record;
  if(record?.state==='scanning')return skipped('SCAN_IN_PROGRESS');
  if(record&&['ready','report_ready','budgeting','submitting'].includes(record.state))return store.update(key,{state:'review',code:'INTERRUPTED_ACTION',updatedAt:at});
  if(job.budget!==null&&job.budget!==undefined&&job.budget!=='0'&&job.budget!==RAW_FEE)return skipped('WRONG_FEE');
  if(job.jobStatus==='FUNDED'&&job.budget!==RAW_FEE)return skipped('WRONG_FEE');
  let request,room;try{room=await transport.history(job);request=requirements(room,job);}catch{return skipped('HISTORY_UNAVAILABLE');}
  if(![job.jobStatus==='FUNDED'?'funded':'open',...(job.jobStatus==='OPEN'?['budget_set']:[])].includes(room.status))return skipped('HISTORY_STATE_MISMATCH');
  if(!request)return skipped('INVALID_REQUIREMENTS');
  const requestHash=hash(JSON.stringify(request));
  if(record&&record.requestHash!==requestHash)return store.update(key,{state:'review',code:'REQUIREMENTS_CHANGED',updatedAt:at});
  async function currentForAction(){
   try{
    const current=await transport.refresh(job);
    if(!current)return false;
    for(const field of ['chainId','onChainJobId','jobStatus','providerAddress','clientAddress','description','budget','expiredAt','hookAddress'])
     if(current[field]!==job[field])return false;
    if(current.clientSubscription!=null||(current.intents?.length)||(current.hookConfigs&&Object.keys(current.hookConfigs).length))return false;
    const latest=await transport.history(current),r=requirements(latest,current);
    return latest.status===room.status&&r&&hash(JSON.stringify(r))===requestHash&&expiry-now()>60000;
   }catch{return false;}
  }
  if(job.jobStatus==='OPEN'){
   if(record)return record;
   // A pre-existing budget not issued by this journal requires operator review.
   if(job.budget!==null&&job.budget!==undefined&&job.budget!=='0')return skipped('UNTRACKED_BUDGET');
   const rows=store.rows();
   if(rows.filter(r=>at-r.createdAt<3600000).length>=20||rows.filter(r=>!['completed','rejected','expired','submitted','deadline_passed'].includes(r.state)).length>=16)return skipped('CAPACITY');
   if(!await currentForAction())return skipped('JOB_CHANGED');
   store.create(key,{state:'ready',requestHash,attempts:0,nextRun:0,createdAt:at,updatedAt:at,expiry});
   if(!store.reserve(key,'ready','budgeting'))return skipped('ALREADY_CLAIMED');
   try{await transport.budget(job,FEE);return store.update(key,{state:'budget_sent',updatedAt:now()});}
   catch{return store.update(key,{state:'review',code:'BUDGET_UNCERTAIN',updatedAt:now()});}
  }
  if(!record||!['budget_sent','retry'].includes(record.state))return skipped('UNTRACKED_FUNDING');
  if(record.nextRun>at)return record;
  if(record.attempts>=3)return store.update(key,{state:'review',code:'SCAN_EXHAUSTED',updatedAt:at});
  if(!store.reserve(key,record.state,'scanning'))return skipped('ALREADY_CLAIMED');
  store.update(key,{attempts:record.attempts+1});
  let result;try{result=await scan(request);}catch{result=null;}
  const report=result?.report;
  if(!report||['FEED_UNAVAILABLE','INVALID_INPUT','INVALID_REQUEST','INVALID_CLOCK','POOL_MISMATCH'].includes(report.code))
   return store.update(key,{state:'retry',nextRun:now()+60000,code:'SCAN_UNAVAILABLE',updatedAt:now()});
  const text=JSON.stringify(result);
  if(report.mode!=='research'||report.liveOrders!==false||report.chainId!==8453||report.poolAddress!==request.poolAddress||
   !['PASS','WAIT','BLOCKED'].includes(report.status)||Buffer.byteLength(text)>65536||
   !Number.isSafeInteger(report.checkedAt)||now()<report.checkedAt||now()-report.checkedAt>90000||expiry-now()<60000)
   return store.update(key,{state:'review',code:'REPORT_INVALID',updatedAt:now()});
  if(!await currentForAction())return store.update(key,{state:'review',code:'JOB_CHANGED',updatedAt:now()});
  if(now()-report.checkedAt>90000||expiry-now()<60000)return store.update(key,{state:'review',code:'REPORT_EXPIRED',updatedAt:now()});
  // Persist the exact deliverable before any external submission.
  store.update(key,{state:'report_ready',deliverable:text,updatedAt:now()});
  if(!store.reserve(key,'report_ready','submitting'))return skipped('ALREADY_CLAIMED');
  try{await transport.submit(job,text);return store.update(key,{state:'submitted',updatedAt:now()});}
  catch{return store.update(key,{state:'review',code:'SUBMIT_UNCERTAIN',updatedAt:now()});}
 }
 return {async reconcile(row){
  const [chain,id]=row.key.split(':');
  if(Number(chain)!==chainId||['completed','rejected','expired','deadline_passed'].includes(row.state))return;
  try{
   const room=await transport.history({chainId,onChainJobId:id});
   if(room?.protocol==='v2'&&room.chainId===chainId&&String(room.jobId)===id&&['completed','rejected','expired'].includes(room.status)){
    store.update(row.key,{state:room.status,code:null,updatedAt:now()});return;
   }
  }catch{/* Preserve the record when remote settlement cannot be established. */}
  if(Number.isFinite(row.expiry)&&now()>row.expiry)store.update(row.key,{state:'deadline_passed',code:'SETTLEMENT_UNVERIFIED',updatedAt:now()});
 },process(job){
  if(queued>=16)return Promise.resolve(skipped('QUEUE_FULL'));
  queued++;const task=queue.then(()=>processJob(job));queue=task.catch(()=>{});
  return task.finally(()=>{queued--;});
 }};
}
