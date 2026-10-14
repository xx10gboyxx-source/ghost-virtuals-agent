import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {MemeOperator} from '../operator.mjs';
import {createBaseMemeFeed} from '../server/base-meme-feed.mjs';
import {createPoolDiscovery,DEFAULT_TOKENS} from '../server/pool-discovery.mjs';
import {STRATEGIES} from '../server/meme-strategy.mjs';
import {scanMemePool} from './meme-scan.mjs';

export const CYCLE_MS=75000;
const LEASE_MS=180000,RETAIN_CYCLES=1000;
const address=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x)&&!/^0x0{40}$/i.test(x);
const timestamp=x=>Number.isSafeInteger(x)&&x>0;
const activePools=s=>[...new Set([...s.positions,...s.orders.filter(o=>o.status==='PENDING')].map(x=>x.poolAddress.toLowerCase()))];
export function validateRuntimeConfig(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['strategy','selection','addresses'].includes(k)))throw new Error('Invalid runtime configuration.');
 const {strategy='volume-breakout',selection='tokens',addresses=DEFAULT_TOKENS}=input;
 if(!STRATEGIES.includes(strategy)||!['tokens','pools'].includes(selection)||!Array.isArray(addresses)||!addresses.length||addresses.length>2||addresses.some(a=>!address(a)))throw new Error('Choose a strategy and one or two nonzero Base token or pool addresses.');
 const normalized=addresses.map(a=>a.toLowerCase());
 if(new Set(normalized).size!==normalized.length)throw new Error('Duplicate Base addresses.');
 return {strategy,selection,addresses:normalized};
}

// Wallet-free local work only. This module never imports ACP transport or inference.
export class GhostRuntime {
 constructor(path,{config,clock=Date.now,fetcher=globalThis.fetch,feedFactory=createBaseMemeFeed,discoveryFactory=createPoolDiscovery}={}){
  if(config!==undefined)config=validateRuntimeConfig(config);
  this.clock=clock;this.clockFloor=0;this.path=resolve(path);this.feedFactory=feedFactory;this.busy=false;this.token=null;this.controller=null;this.stopped=false;
  const existed=existsSync(this.path);
  this.operator=new MemeOperator(this.path,{clock:()=>this.now(),strategy:config?.strategy??'volume-breakout'});
  this.db=this.operator.db;
  try{
   this.db.exec(`CREATE TABLE IF NOT EXISTS ghost_runtime (
    id INTEGER PRIMARY KEY CHECK(id=1),config TEXT NOT NULL,auto_start INTEGER NOT NULL,
    last_cycle INTEGER NOT NULL DEFAULT 0,next_cycle INTEGER NOT NULL DEFAULT 0,
    lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS ghost_cycles(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ghost_http_requests(at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ghost_http_backoff(origin TEXT PRIMARY KEY,until_at INTEGER NOT NULL);`);
   let stored=this.db.prepare('SELECT * FROM ghost_runtime WHERE id=1').get();
   const wanted=validateRuntimeConfig(config??(stored?JSON.parse(stored.config):{strategy:this.operator.status().strategy}));
   if(stored&&JSON.stringify(wanted)!==stored.config)throw new Error('Runtime configuration differs from the saved session; use its configuration or a separate database.');
   if(wanted.strategy!==this.operator.status().strategy)throw new Error('Runtime and ledger strategies must match.');
   const ledger=this.operator.status();
   const open=[...ledger.positions,...ledger.orders.filter(o=>o.status==='PENDING')];
   if(open.some(p=>!wanted.addresses.includes((wanted.selection==='tokens'?p.tokenAddress:p.poolAddress).toLowerCase())))throw new Error('Existing positions or pending orders are outside this watchlist. Include their exact tokens/pools or use a separate database.');
   this.config=wanted;
   if(!stored)this.db.prepare('INSERT INTO ghost_runtime(id,config,auto_start) VALUES(1,?,?)').run(JSON.stringify(wanted),existed?0:1);
   this.readControl();
   const boundedFetch=async(url,options)=>{
    this.assertLease();
    const parsed=new URL(url),at=this.now();
    if(!['https://api.geckoterminal.com','https://api.gopluslabs.io'].includes(parsed.origin)||options?.method!=='GET'||options?.credentials!=='omit'||options?.redirect!=='error')throw new Error('Unsupported public request.');
    this.db.exec('BEGIN IMMEDIATE');
    try{
     this.db.prepare('DELETE FROM ghost_http_requests WHERE at<=?').run(at-60000);
     const requests=this.db.prepare('SELECT COUNT(*) AS count,MAX(at) AS latest FROM ghost_http_requests').get();
     const backoff=this.db.prepare('SELECT until_at FROM ghost_http_backoff WHERE origin=?').get(parsed.origin)?.until_at??0;
     if(requests.latest>at||requests.count>=8||backoff>at)throw new Error('Public data cooldown.');
     this.db.prepare('INSERT INTO ghost_http_requests(at) VALUES(?)').run(at);this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    const response=await fetcher(url,{...options,signal:AbortSignal.any([options.signal,this.controller.signal])});
    this.assertLease();
    if(response.status===429){
     const retry=response.headers.get('retry-after'),seconds=retry!==null&&/^\d+(?:\.\d+)?$/.test(retry)?Number(retry):NaN;
     const delay=Number.isFinite(seconds)?seconds*1000:Date.parse(retry??'')-this.now();
     const until=Math.min(Number.MAX_SAFE_INTEGER,this.now()+Math.max(60000,Number.isFinite(delay)?delay:60000));
     this.db.prepare('INSERT INTO ghost_http_backoff(origin,until_at) VALUES(?,?) ON CONFLICT(origin) DO UPDATE SET until_at=MAX(until_at,excluded.until_at)').run(parsed.origin,until);
    }
    return response;
   };
   this.fetcher=boundedFetch;
   this.discovery=discoveryFactory({tokens:wanted.selection==='tokens'?wanted.addresses:DEFAULT_TOKENS,fetcher:boundedFetch,now:()=>this.now()});
  }catch(error){this.operator.close();throw error;}
 }
 now(){const at=this.clock();if(!timestamp(at))throw new Error('Invalid runtime clock.');if(at<this.clockFloor)throw new Error('Runtime clock regressed.');this.clockFloor=at;return at;}
 readControl(){
  const c=this.db.prepare('SELECT * FROM ghost_runtime WHERE id=1').get();
  if(!c||![0,1].includes(c.auto_start)||!['last_cycle','next_cycle','lease_until'].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0)||c.next_cycle<c.last_cycle||!(c.lease_token===null||typeof c.lease_token==='string'))throw new Error('Invalid runtime recovery record.');
  return c;
 }
 assertLease(){
  const c=this.readControl();
  const at=this.now();
  if(at<c.last_cycle)throw new Error('Runtime clock regressed.');
  if(this.stopped||!this.token||c.lease_token!==this.token||c.lease_until<=at)throw new Error('Runtime lease lost or shutdown requested.');
 }
 claim(){
  const at=this.now(),c=this.readControl();
  if(at<c.last_cycle)throw new Error('Runtime clock regressed.');
  const token=crypto.randomUUID();
  const claim=this.db.prepare('UPDATE ghost_runtime SET lease_token=?,lease_until=? WHERE id=1 AND (lease_token IS NULL OR lease_until<=?)').run(token,at+LEASE_MS,at);
  if(!claim.changes)throw new Error('Another runtime owns this database.');
  this.token=token;this.controller=new AbortController();return at;
 }
 release(){
  if(this.token)this.db.prepare('UPDATE ghost_runtime SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?').run(this.token);
  this.token=null;this.controller=null;
 }
 status(){
  const control=this.readControl(),simulation=this.operator.status(),last=this.db.prepare('SELECT payload FROM ghost_cycles ORDER BY id DESC LIMIT 1').get();
  return {agent:'GhOsT',mode:'simulation',liveOrders:false,walletRequired:false,inferenceRequired:false,
   configuration:this.config,lastCycleAt:control.last_cycle,nextCycleAt:control.next_cycle,
   research:'continuous-while-process-runs',simulationState:simulation.riskLock?'RISK_LOCK':simulation.enabled?'ACTIVE':simulation.sessionUntil&&simulation.sessionUntil<=this.now()?'SESSION_ENDED':'PAUSED',
   simulation,latest:last?JSON.parse(last.payload):null};
 }
 reports(limit=10){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Choose 1 to 100 saved cycles.');
  return this.db.prepare('SELECT payload FROM ghost_cycles ORDER BY id DESC LIMIT ?').all(limit).map(r=>JSON.parse(r.payload));
 }
 async control(command){
  if(!['pause','resume'].includes(command)||this.busy)throw new Error('Use pause or resume when no local cycle is in progress.');
  this.claim();
  try{this.db.prepare('UPDATE ghost_runtime SET auto_start=0 WHERE id=1').run();return await this.operator.action(command==='resume'?'start':'pause');}
  finally{this.release();}
 }
 async cycle(){
  if(this.busy||this.stopped)throw new Error('Runtime is busy or stopped.');
  this.busy=true;
  try{
   const at=this.claim(),control=this.readControl();
   if(at<control.next_cycle)return {agent:'GhOsT',mode:'simulation',liveOrders:false,status:'WAIT',code:'SCAN_COOLDOWN',checkedAt:at,nextCycleAt:control.next_cycle};
   // Reserve cadence before I/O so a crash cannot create an immediate retry storm.
   this.db.prepare('UPDATE ghost_runtime SET last_cycle=?,next_cycle=? WHERE id=1').run(at,at+CYCLE_MS);
   if(control.auto_start){
    this.db.prepare('UPDATE ghost_runtime SET auto_start=0 WHERE id=1').run();
    const s=this.operator.status();
    if(s.sessionUntil===0&&s.lastTick===0&&!s.riskLock&&!s.positions.length&&!s.orders.length)await this.operator.action('start');
   }
   const before=this.operator.status(),pinned=activePools(before);
   let selection={status:'OK',code:'EXPLICIT_POOLS',source:'explicit-pools',pools:this.config.addresses,checkedAt:at};
   if(this.config.selection==='tokens'){
    try{selection=await this.discovery.discover();}catch{selection={status:'WAIT',code:'DISCOVERY_UNAVAILABLE',source:'token-pools',pools:[],checkedAt:this.now()};}
   }
   this.assertLease();
   const discovered=Array.isArray(selection.pools)?selection.pools.filter(address).map(p=>p.toLowerCase()):[];
   const pools=[...new Set([...pinned,...discovered])].slice(0,2);
   let snapshots=[],feedStatus='WAIT';
   if(pools.length){
    const feedKey=pools.join(',');
    try{
     if(this.feedKey!==feedKey){this.feed=this.feedFactory({pools,fetcher:this.fetcher,now:()=>this.now()});this.feedKey=feedKey;}
     const rows=await this.feed.snapshots();
     if(!Array.isArray(rows)||rows.length!==pools.length||new Set(rows.map(r=>r?.poolAddress?.toLowerCase())).size!==pools.length||rows.some(r=>r?.chainId!==8453||!address(r?.poolAddress)||!pools.includes(r.poolAddress.toLowerCase())||!address(r?.tokenAddress)||(this.config.selection==='tokens'&&!this.config.addresses.includes(r.tokenAddress.toLowerCase()))))throw new Error('Market identity mismatch.');
     snapshots=rows;feedStatus='OK';
    }catch{snapshots=[];}
   }
   this.assertLease();
   this.operator.feed={snapshots:async()=>structuredClone(snapshots)};
   const simulation=await this.operator.action('tick');
   const reports=[];
   for(const poolAddress of pools)for(const strategy of STRATEGIES){
    const result=await scanMemePool({poolAddress,strategy},{now:()=>this.now(),feedFactory:()=>({snapshots:async()=>structuredClone(snapshots.filter(r=>r.poolAddress.toLowerCase()===poolAddress))})});
    reports.push(result.report);
   }
   this.assertLease();
   const completedAt=this.now(),nextCycleAt=completedAt+CYCLE_MS;
   const result={agent:'GhOsT',mode:'simulation',liveOrders:false,walletRequired:false,checkedAt:completedAt,
    health:'RUNNING',marketData:feedStatus,selection:{source:selection.source,status:selection.status,code:selection.code,pools,checkedAt:selection.checkedAt},
    reports,simulation,nextCycleAt};
   const payload=JSON.stringify(result);if(Buffer.byteLength(payload)>262144)throw new Error('Cycle report exceeds storage limit.');
   this.db.exec('BEGIN IMMEDIATE');
   try{
    this.db.prepare('INSERT INTO ghost_cycles(at,payload) VALUES(?,?)').run(completedAt,payload);
    this.db.prepare('DELETE FROM ghost_cycles WHERE id NOT IN (SELECT id FROM ghost_cycles ORDER BY id DESC LIMIT ?)').run(RETAIN_CYCLES);
    this.db.prepare('UPDATE ghost_runtime SET last_cycle=?,next_cycle=? WHERE id=1 AND lease_token=?').run(completedAt,nextCycleAt,this.token);
    this.db.exec('COMMIT');
   }catch(error){this.db.exec('ROLLBACK');throw error;}
   return result;
  }finally{this.release();this.busy=false;}
 }
 stop(){this.stopped=true;this.controller?.abort();}
 close(){if(this.busy)throw new Error('Wait for the current cycle before closing.');this.release();this.operator.close();}
}
