import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JobStore,createJobWorker,createSharedScan} from '../agent/acp-worker.mjs';
import {scanMemePool} from '../agent/meme-scan.mjs';
import {memeFixture,FIXTURE_TIME} from '../examples/meme-fixture.mjs';

const provider='0x'+'a'.repeat(40),client='0x'+'b'.repeat(40),zero='0x'+'0'.repeat(40);
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'ghost-acp-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'jobs.sqlite');let store=new JobStore(path);t.after(()=>store.close());
 let now=FIXTURE_TIME;
 const job={chainId:84532,onChainJobId:'42',jobStatus:'OPEN',providerAddress:provider,clientAddress:client,
  description:'ghost_base_meme_scan',budget:null,expiredAt:new Date(now+600000).toISOString(),hookAddress:zero};
 const entries=[{kind:'message',from:client,contentType:'requirement',content:JSON.stringify({poolAddress:memeFixture().poolAddress})}];
 const calls=[];
 const transport={async history(){return {protocol:'v2',jobId:'42',chainId:84532,status:job.jobStatus==='FUNDED'?'funded':'open',entries};},async refresh(){return {...job};},
  async budget(j,fee){calls.push(['budget',fee]);},async submit(j,text){calls.push(['submit',JSON.parse(text)]);}};
 const scan=input=>scanMemePool(input,{now:()=>now,feedFactory:()=>({snapshots:async()=>[memeFixture()]})});
 const make=()=>createJobWorker({store,transport,scan,provider,chainId:84532,now:()=>now});
 return {job,entries,calls,transport,scan,make,get store(){return store;},setClock(value){now=value;},
  restart(){store.close();store=new JobStore(path);return make();}};
}

test('provider lifecycle validates, quotes once, scans only funded jobs and submits JSON',async t=>{
 const f=fixture(t),worker=f.make();
 assert.equal((await worker.process(f.job)).state,'budget_sent');assert.deepEqual(f.calls,[['budget','0.01']]);
 await worker.process(f.job);assert.equal(f.calls.length,1);
 f.job.jobStatus='FUNDED';f.job.budget='10000';
 assert.equal((await worker.process(f.job)).state,'submitted');
 assert.equal(f.calls[1][1].report.liveOrders,false);assert.equal(f.calls[1][1].report.status,'PASS');
 await f.restart().process(f.job);assert.equal(f.calls.length,2);
});

test('foreign jobs, chains, offerings, hooks and invalid budgets never sign',async t=>{
 const f=fixture(t),worker=f.make();
 for(const change of [{chainId:8453},{providerAddress:client},{description:'ghost_web_scraper'},
  {hookAddress:client},{onChainJobId:'42; echo unsafe'},{expiredAt:'invalid'},
  {jobStatus:'FUNDED',budget:'10001'},{jobStatus:'FUNDED',budget:'0.01'}]){
  await worker.process({...f.job,...change});
 }
 assert.equal(f.calls.length,0);
});

test('untrusted, multiple, oversized and invalid requirements do not quote',async t=>{
 const f=fixture(t),worker=f.make();const original=structuredClone(f.entries);
 for(const change of [()=>{f.entries[0].from=provider;},()=>{f.entries.push({...f.entries[0]});},
  ()=>{f.entries[0].content='x'.repeat(4097);},()=>{f.entries[0].content='{"execute":true}';}]){
  f.entries.splice(0,f.entries.length,...structuredClone(original));change();await worker.process(f.job);
 }
 assert.equal(f.calls.length,0);
});

test('changed requirements after quote stop delivery',async t=>{
 const f=fixture(t);await f.make().process(f.job);
 f.entries[0].content=JSON.stringify({poolAddress:'0x'+'c'.repeat(40)});f.job.jobStatus='FUNDED';f.job.budget='10000';
 assert.equal((await f.make().process(f.job)).state,'review');assert.equal(f.calls.length,1);
});

test('ambiguous budget failure is durable and never blindly retried',async t=>{
 const f=fixture(t);f.transport.budget=async()=>{f.calls.push(['budget']);throw new Error('secret transport error');};
 assert.equal((await f.make().process(f.job)).state,'review');
 await f.restart().process(f.job);assert.equal(f.calls.length,1);
 assert.ok(!JSON.stringify(f.store.rows()).includes('secret transport'));
});

test('ambiguous submit failure is durable and never blindly retried',async t=>{
 const f=fixture(t);await f.make().process(f.job);f.job.jobStatus='FUNDED';f.job.budget='10000';
 f.transport.submit=async()=>{f.calls.push(['submit']);throw new Error('private-error');};
 assert.equal((await f.make().process(f.job)).state,'review');await f.restart().process(f.job);
 assert.equal(f.calls.length,2);
});

test('feed outage retries are bounded and never submit a fake completed report',async t=>{
 const f=fixture(t);await f.make().process(f.job);f.job.jobStatus='FUNDED';f.job.budget='10000';let scans=0;
 let at=FIXTURE_TIME;const worker=createJobWorker({store:f.store,transport:f.transport,provider,chainId:84532,now:()=>at,
  scan:async()=>{scans++;return {report:{code:'FEED_UNAVAILABLE'}};}});
 await worker.process(f.job);await worker.process(f.job);assert.equal(scans,1);assert.equal(f.calls.length,1);
 at+=60000;await worker.process(f.job);at+=60000;await worker.process(f.job);at+=60000;
 assert.equal((await worker.process(f.job)).state,'review');assert.equal(scans,3);assert.equal(f.calls.length,1);
});

test('terminal, expiring and unquoted funded jobs do not submit',async t=>{
 const f=fixture(t),worker=f.make();
 for(const jobStatus of ['COMPLETED','REJECTED','EXPIRED','SUBMITTED','FUNDED'])await worker.process({...f.job,jobStatus,budget:'10000'});
 await worker.process({...f.job,onChainJobId:'43',expiredAt:new Date(FIXTURE_TIME+60000).toISOString()});
 assert.equal(f.calls.length,0);
});

test('duplicate concurrent events serialize to a single budget action',async t=>{
 const f=fixture(t),worker=f.make();await Promise.all(Array.from({length:8},()=>worker.process(f.job)));
 assert.equal(f.calls.length,1);
});

test('restart after durable submission intent blocks retransmission',async t=>{
 const f=fixture(t);await f.make().process(f.job);f.store.update('84532:42',{state:'submitting'});
 f.job.jobStatus='FUNDED';f.job.budget='10000';
 assert.equal((await f.restart().process(f.job)).state,'review');assert.equal(f.calls.length,1);
});

test('fresh history and last-minute job changes prevent stale signed actions',async t=>{
 const f=fixture(t),worker=f.make(),original=f.transport.history;
 f.transport.history=async()=>({...await original(),status:'completed'});
 assert.equal((await worker.process(f.job)).code,'HISTORY_STATE_MISMATCH');assert.equal(f.calls.length,0);
 f.transport.history=original;f.transport.refresh=async()=>({...f.job,jobStatus:'EXPIRED'});
 assert.equal((await worker.process(f.job)).code,'JOB_CHANGED');assert.equal(f.calls.length,0);
});

test('standard zero budget is accepted while subscription and hook metadata are refused',async t=>{
 const f=fixture(t),worker=f.make();
 for(const extra of [{hookConfigs:{recipient:[client]}},{clientSubscription:{packageId:1}},{intents:[{}]}])await worker.process({...f.job,...extra});
 assert.equal(f.calls.length,0);f.job.budget='0';assert.equal((await worker.process(f.job)).state,'budget_sent');
});

test('absent jobs reconcile authoritative settlement and local deadline without inventing completion',async t=>{
 const f=fixture(t),worker=f.make();await worker.process(f.job);
 f.transport.history=async()=>({protocol:'v2',jobId:'42',chainId:84532,status:'completed',entries:[]});
 await worker.reconcile(f.store.get('84532:42'));assert.equal(f.store.get('84532:42').state,'completed');
 f.store.update('84532:42',{state:'budget_sent'});f.transport.history=async()=>{throw new Error('unavailable');};f.setClock(FIXTURE_TIME+700000);
 await worker.reconcile(f.store.get('84532:42'));assert.equal(f.store.get('84532:42').state,'deadline_passed');
 assert.equal(f.store.get('84532:42').code,'SETTLEMENT_UNVERIFIED');
});

test('independent workers cannot scan and submit the same funded job twice',async t=>{
 const f=fixture(t);await f.make().process(f.job);f.job.jobStatus='FUNDED';f.job.budget='10000';
 await Promise.all([f.make().process(f.job),f.make().process(f.job)]);
 assert.equal(f.calls.filter(c=>c[0]==='submit').length,1);
});

test('market request budget is shared across different caller-selected pools',async()=>{
 let calls=0;
 const scan=createSharedScan({now:()=>FIXTURE_TIME,fetcher:async()=>{calls++;return new Response('{}',{status:200});}});
 for(let i=1;i<=12;i++)await scan({poolAddress:'0x'+String(i).padStart(40,'0')});
 assert.equal(calls,8);
});
