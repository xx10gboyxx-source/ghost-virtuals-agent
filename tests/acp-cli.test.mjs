import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCli,validateConfig,runWorker} from '../agent/acp-cli.mjs';
import {JobStore} from '../agent/acp-worker.mjs';
import {scanMemePool} from '../agent/meme-scan.mjs';
import {memeFixture,FIXTURE_TIME} from '../examples/meme-fixture.mjs';

const config={agentId:'01a0ddd4-4982-70d0-b660-0ec5cccd0e12',chainId:84532,statePath:'/tmp/ghost-test.sqlite'};
const wallet='0x'+'a'.repeat(40),job={onChainJobId:'42',chainId:84532,expiredAt:new Date(Date.now()+600000).toISOString()};
const identity={id:config.agentId,walletAddress:wallet};
const offering={agentId:config.agentId,name:'ghost_base_meme_scan',priceType:'fixed',priceValue:'0.01',requiredFunds:false,slaMinutes:10,isHidden:true};
function fixture(){
 let profile=identity;const calls=[];
 const run=async(binary,args,options)=>{
  calls.push({binary,args,options});let value;
  if(args[0]==='--version')return {stdout:'1.0.40\n'};
  if(args[0]==='agent')value=profile;
  else if(args[0]==='offering')value=[offering];
  else if(args[0]==='provider')value={success:true,action:args[1],jobId:'42',amount:0.01,deliverable:args[args.indexOf('--deliverable')+1]};
  else value={jobs:[]};
  return {stdout:JSON.stringify(value)};
 };
 return {calls,run,switchIdentity(){profile={...identity,id:'foreign'};}};
}
test('preflight verifies official version, expected identity and fixed research offering',async()=>{
 const f=fixture(),cli=createCli({chainId:84532,run:f.run});const result=await cli.preflight(config);
 assert.equal(result.provider,wallet);assert.equal(result.hidden,true);
 assert.ok(f.calls.every(c=>c.options.env.IS_TESTNET==='true'));assert.ok(f.calls.every(c=>c.options.timeout===60000));
});
test('provider calls use argv, unchanged deliverable, correct chain and no client/wallet/trade commands',async()=>{
 const f=fixture(),cli=createCli({chainId:84532,run:f.run,guard:()=>true});await cli.preflight(config);
 const payload=JSON.stringify({report:{checkedAt:Date.now(),reason:'literal $(echo unsafe) `not a shell`'}});
 await cli.budget(job,'0.01');await cli.submit(job,payload);
 const mutations=f.calls.filter(c=>c.args[0]==='provider');assert.equal(mutations.length,2);
 assert.deepEqual(mutations[1].args,['provider','submit','--job-id','42','--chain-id','84532','--deliverable',payload,'--json']);
 assert.equal(mutations[1].options.shell,undefined);
});
test('lost lease or changed active identity prevents signing',async()=>{
 const f=fixture(),cli=createCli({chainId:84532,run:f.run});await cli.preflight(config);
 await assert.rejects(cli.budget(job,'0.01'),/lease/);
 const second=createCli({chainId:84532,run:f.run,guard:()=>true});await second.preflight(config);f.switchIdentity();
 await assert.rejects(second.submit(job,'{}'),/identity/);assert.equal(f.calls.filter(c=>c.args[0]==='provider').length,0);
});
test('CLI errors are redacted and malformed results fail closed',async()=>{
 const failing=createCli({chainId:84532,run:async()=>{throw new Error('secret-token');}});
 await assert.rejects(failing.jobs(),e=>!e.message.includes('secret-token'));
 const bad=createCli({chainId:84532,run:async()=>({stdout:'not-json'})});await assert.rejects(bad.jobs(),/invalid response/);
 const oversized=createCli({chainId:84532,run:async()=>({stdout:JSON.stringify({jobs:Array(2001).fill({})})})});await assert.rejects(oversized.jobs(),/bounds/);
});
test('configuration refuses unknown capabilities and unsupported networks',()=>{
 for(const bad of [{...config,privateKey:'unused'},{...config,chainId:1},{...config,agentId:'other'},{...config,statePath:'data.json'}])assert.throws(()=>validateConfig(bad));
});
test('persistent process lease and identity binding prevent overlapping or mixed agents',t=>{
 const dir=mkdtempSync(join(tmpdir(),'ghost-lease-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const a=new JobStore(join(dir,'jobs.sqlite')),b=new JobStore(join(dir,'jobs.sqlite'));t.after(()=>{a.close();b.close();});
 assert.equal(a.acquire('a',1000),true);assert.equal(b.acquire('b',1001),false);
 assert.equal(b.renew('b',2000),false);assert.equal(a.owns('a',121001),false);
 assert.equal(b.acquire('b',121001),true);assert.equal(a.renew('a',121002),false);
 const binding={agentId:config.agentId,provider:wallet,chainId:84532};a.bindIdentity(binding);b.bindIdentity(binding);
 assert.throws(()=>b.bindIdentity({...binding,chainId:8453}),/different agent/);
});
test('real child-process CLI boundary preserves multiline JSON and filters events',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'ghost-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const script=join(dir,'fake-cli.mjs');writeFileSync(script,`
 const args=process.argv.slice(2);
 if(args[0]==='events'){
  console.log(JSON.stringify({chainId:8453,legacy:false,roles:['provider']}));
  console.log(JSON.stringify({chainId:84532,legacy:false,roles:['client']}));
  console.log(JSON.stringify({chainId:84532,legacy:false,roles:['provider']}));
  setInterval(()=>{},1000);
 }else console.log(JSON.stringify({jobs:[{chainId:84532,onChainJobId:'42'}]}));
 `);
 const cli=createCli({chainId:84532,binary:process.execPath,prefix:[script]});
 assert.equal((await cli.jobs())[0].onChainJobId,'42');
 let stop;await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{stop?.();reject(new Error('event timeout'));},3000);
  stop=cli.listen(()=>{clearTimeout(timeout);stop();resolve();},()=>{clearTimeout(timeout);reject(new Error('listener failed'));});
 });
});

test('full runner completes a simulated CLI job through the actual meme scanner',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'ghost-acp-runner-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const script=join(dir,'fake-cli.mjs'),state=join(dir,'remote.json');
 const client='0x'+'b'.repeat(40),pool=memeFixture().poolAddress;
 writeFileSync(state,JSON.stringify({phase:'OPEN',budget:null,calls:[]}));
 writeFileSync(script,`
 import {readFileSync,writeFileSync} from 'node:fs';
 const args=process.argv.slice(2),path=${JSON.stringify(state)},state=JSON.parse(readFileSync(path));
 const job={chainId:84532,onChainJobId:'42',jobStatus:state.phase,budget:state.budget,providerAddress:${JSON.stringify(wallet)},clientAddress:${JSON.stringify(client)},description:'ghost_base_meme_scan',expiredAt:${JSON.stringify(job.expiredAt)},hookAddress:'0x'+'0'.repeat(40)};
 let output;
 if(args[0]==='--version'){console.log('1.0.40');process.exit(0);}
 if(args[0]==='agent')output=${JSON.stringify(identity)};
 else if(args[0]==='offering')output=[${JSON.stringify(offering)}];
 else if(args[0]==='job'&&args[1]==='list')output={jobs:[job]};
 else if(args[0]==='job')output={protocol:'v2',jobId:'42',chainId:84532,status:state.phase==='FUNDED'?'funded':'open',entries:[{kind:'message',from:${JSON.stringify(client)},contentType:'requirement',content:JSON.stringify({poolAddress:${JSON.stringify(pool)}})}]};
 else if(args[0]==='provider'){
  state.calls.push(args[1]);
  if(args[1]==='set-budget'){state.phase='FUNDED';state.budget='10000';output={success:true,action:'set-budget',jobId:'42',amount:0.01};}
  else{state.phase='SUBMITTED';state.report=JSON.parse(args[args.indexOf('--deliverable')+1]);output={success:true,action:'submit',jobId:'42',deliverable:args[args.indexOf('--deliverable')+1]};}
  writeFileSync(path,JSON.stringify(state));
 }else if(args[0]==='events'){
  setInterval(()=>console.log(JSON.stringify({chainId:84532,legacy:false,roles:['provider']})),100);
 }else process.exit(1);
 if(output)console.log(JSON.stringify(output));
 `);
 const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),15000);t.after(()=>clearTimeout(timeout));
 const scan=input=>{const s=memeFixture(),delta=Math.floor(Date.now()/300000)*300000-FIXTURE_TIME;
  s.observedAt=Date.now();s.security.checkedAt=Date.now();s.poolCreatedAt+=delta;s.candles.forEach(c=>{c.time+=delta/1000;});
  return scanMemePool(input,{feedFactory:()=>({snapshots:async()=>[s]})});};
 await assert.rejects(runWorker({...config,statePath:join(dir,'jobs.sqlite')},{binary:process.execPath,prefix:[script],signal:abort.signal,scan,
  log:line=>{if(JSON.parse(line).state==='submitted')abort.abort();}}),/Worker stopped/);
 const remote=JSON.parse(readFileSync(state));assert.deepEqual(remote.calls,['set-budget','submit']);
 assert.equal(remote.report.report.liveOrders,false);assert.equal(remote.report.report.chainId,8453);
 const journal=new JobStore(join(dir,'jobs.sqlite'));try{assert.equal(journal.get('84532:42').state,'submitted');}finally{journal.close();}
});
