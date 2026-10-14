import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {JobStore,createJobWorker,OFFERING} from './acp-worker.mjs';

const execute=promisify(execFile),VERSION='1.0.40',MAX_OUTPUT=2*1024*1024;
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
export function validateConfig(config){
 if(!config||typeof config!=='object'||Array.isArray(config)||
  Object.keys(config).some(k=>!['agentId','chainId','statePath'].includes(k))||!uuid(config.agentId)||
  ![84532,8453].includes(config.chainId)||typeof config.statePath!=='string'||!config.statePath.endsWith('.sqlite'))
  throw new Error('Config requires agentId, chainId (84532 or 8453), and private statePath ending .sqlite.');
 return {...config,statePath:resolve(config.statePath)};
}

// Credential storage and signing remain inside the official CLI/OS keychain.
// No shell interpolation, private keys, fund requests, swaps or buyer actions.
export function createCli({chainId,binary='acp',prefix=[],run=execute,guard=()=>false}={}){
 const env={...process.env,IS_TESTNET:chainId===84532?'true':'false',NO_COLOR:'1'};
 let expectedIdentity=null;
 async function command(args,{json=true}={}){
  let stdout;try{({stdout}=await run(binary,[...prefix,...args,...(json?['--json']:[])],
   {env,encoding:'utf8',timeout:60000,maxBuffer:MAX_OUTPUT,killSignal:'SIGKILL',windowsHide:true}));}
  catch{throw new Error('ACP command failed; authentication, signer or network may be unavailable.');}
  if(!json)return stdout.trim();
  try{return JSON.parse(stdout);}catch{throw new Error('ACP returned an invalid response.');}
 }
 const baseArgs=job=>['--job-id',job.onChainJobId,'--chain-id',String(job.chainId)];
 async function jobs(){const result=await command(['job','list']);
  if(!Array.isArray(result?.jobs)||result.jobs.length>2000)throw new Error('ACP job list exceeds the supported bounds.');
  return result.jobs;
 }
 async function signed(job,action,args){
  if(job.chainId!==chainId||!guard())throw new Error('Worker lease or chain mismatch.');
  const identity=await command(['agent','whoami']);
  if(!expectedIdentity||identity?.id!==expectedIdentity.id||identity.walletAddress?.toLowerCase()!==expectedIdentity.walletAddress||!guard()||Date.parse(job.expiredAt)-Date.now()<60000)throw new Error('ACP identity changed or deadline reached.');
  if(action==='submit'){
   const report=JSON.parse(args[1])?.report,at=Date.now();
   if(!Number.isSafeInteger(report?.checkedAt)||at<report.checkedAt||at-report.checkedAt>90000)throw new Error('Report expired before submission.');
  }
  const r=await command(['provider',action,...baseArgs(job),...args]);
  if(r?.success!==true||r.action!==action||String(r.jobId)!==job.onChainJobId||
   (action==='set-budget'&&r.amount!==0.01)||(action==='submit'&&r.deliverable!==args[1]))throw new Error('Unconfirmed ACP action.');
 }
 return {
  async preflight(config){
   if(await command(['--version'],{json:false})!==VERSION)throw new Error(`Install the reviewed ACP CLI ${VERSION}.`);
   const identity=await command(['agent','whoami']);
   if(identity?.id!==config.agentId||typeof identity.walletAddress!=='string'||!/^0x[0-9a-f]{40}$/i.test(identity.walletAddress))
    throw new Error('The active ACP identity does not match this worker configuration.');
   const offerings=await command(['offering','list']);
   if(!Array.isArray(offerings))throw new Error('Invalid offering response.');
   const matches=offerings.filter(o=>o.name===OFFERING&&o.agentId===config.agentId);
   if(matches.length!==1)throw new Error('Exactly one GhOsT meme offering is required.');
   const o=matches[0];
   if(o.priceType!=='fixed'||typeof o.priceValue!=='string'||!/^0\.010*$/.test(o.priceValue)||o.requiredFunds!==false||
    o.slaMinutes!==10||(o.subscriptions!=null&&(!Array.isArray(o.subscriptions)||o.subscriptions.length)))
    throw new Error('Offering must be fixed $0.01, 10 minutes, without funds or subscriptions.');
   expectedIdentity={id:identity.id,walletAddress:identity.walletAddress.toLowerCase()};
   return {agentId:identity.id,provider:identity.walletAddress.toLowerCase(),chainId,offering:OFFERING,hidden:o.isHidden===true,cliVersion:VERSION};
  },
  jobs,
  history:job=>command(['job','history',...baseArgs(job)]),
  async refresh(job){const matches=(await jobs()).filter(j=>j.chainId===job.chainId&&j.onChainJobId===job.onChainJobId);return matches.length===1?matches[0]:null;},
  budget:(job,fee)=>signed(job,'set-budget',['--amount',fee]),
  submit:(job,text)=>signed(job,'submit',['--deliverable',text]),
  listen(onWake,onFailure){
   const child=spawn(binary,[...prefix,'events','listen','--json'],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
   let buffer='',stopped=false;
   const fail=()=>{if(!stopped){stopped=true;child.kill('SIGKILL');onFailure();}};
   child.stdout.setEncoding('utf8');
   child.stdout.on('data',chunk=>{
    buffer+=chunk;if(Buffer.byteLength(buffer)>MAX_OUTPUT)return fail();
    let newline;while((newline=buffer.indexOf('\n'))!==-1){
     const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line.trim())continue;
     try{const event=JSON.parse(line);if(event.chainId===chainId&&event.legacy===false&&Array.isArray(event.roles)&&event.roles.includes('provider'))onWake();}
     catch{fail();return;}
    }
   });
   // Drain but never echo CLI stderr, which could contain private account data.
   child.stderr.on('data',()=>{});child.once('error',fail);child.once('exit',fail);
   return ()=>{stopped=true;child.kill('SIGKILL');};
  }
 };
}

export async function runWorker(config,{binary='acp',prefix=[],signal,log=console.log,scan}={}){
 config=validateConfig(config);const store=new JobStore(config.statePath),owner=randomUUID();
 let listenerStop,heartbeat,timer,stopping=false,dirty=true,cursor=0;
 const guard=()=>!stopping&&store.owns(owner,Date.now());
 if(!store.acquire(owner,Date.now())){store.close();throw new Error('Another worker owns this journal.');}
 heartbeat=setInterval(()=>{if(!store.renew(owner,Date.now()))stopping=true;},15000);
 const cli=createCli({chainId:config.chainId,binary,prefix,guard});
 const shutdown=()=>{stopping=true;};signal?.addEventListener('abort',shutdown,{once:true});
 try{
  const identity=await cli.preflight(config);
  if(!guard())throw new Error('Worker lease expired during preflight.');
  store.bindIdentity(identity);
  for(const row of store.rows())if(['ready','report_ready','scanning','budgeting','submitting'].includes(row.state))
   store.update(row.key,{state:'review',code:'INTERRUPTED_ACTION',updatedAt:Date.now()});
  const worker=createJobWorker({store,transport:cli,provider:identity.provider,chainId:config.chainId,...(scan?{scan}:{})});
  listenerStop=cli.listen(()=>{dirty=true;},()=>{stopping=true;});
  log(JSON.stringify({status:'listening',chainId:config.chainId,offering:OFFERING,liveTrading:false}));
  let nextPoll=0,lastIdentity=Date.now();
  while(!stopping){
   if(!guard())throw new Error('Worker lease expired.');
   if(Date.now()-lastIdentity>60000){await cli.preflight(config);lastIdentity=Date.now();}
   if(dirty||Date.now()>=nextPoll){
    dirty=false;nextPoll=Date.now()+30000;
    // Events are wakeups, not an authoritative or destructive queue. Fresh list
    // catch-up recovers missed events after reconnects and process restarts.
    const jobs=(await cli.jobs()).filter(j=>j.chainId===config.chainId&&j.description===OFFERING&&j.providerAddress?.toLowerCase()===identity.provider);
    const active=new Set(jobs.map(j=>`${j.chainId}:${j.onChainJobId}`));
    for(const row of store.rows().filter(r=>!active.has(r.key)&&!['completed','rejected','expired','deadline_passed'].includes(r.state)).slice(0,16)){
     if(!guard())throw new Error('Worker lease expired.');await worker.reconcile(row);
    }
    const count=Math.min(16,jobs.length);
    for(let i=0;i<count&&!stopping;i++){
     const job=jobs[(cursor+i)%jobs.length],result=await worker.process(job);
     log(JSON.stringify({jobId:job.onChainJobId,state:result.state,code:result.code??null}));
    }
    cursor=jobs.length?(cursor+count)%jobs.length:0;
   }
   // Coalesce event bursts to at most one authoritative poll per five seconds.
   if(!stopping)await new Promise(done=>{timer=setTimeout(done,5000);});
  }
  throw new Error('Worker stopped; inspect service health before restarting.');
 }finally{
  stopping=true;listenerStop?.();clearInterval(heartbeat);clearTimeout(timer);
  signal?.removeEventListener('abort',shutdown);store.release(owner);store.close();
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [command='preflight',path]=process.argv.slice(2);
 try{
  if(!path||!['preflight','run','status'].includes(command))throw new Error('Usage: node agent/acp-cli.mjs preflight|run|status /private/worker.json');
  const raw=readFileSync(path);if(raw.length>4096)throw new Error('Config is too large.');
  const config=validateConfig(JSON.parse(raw));
  if(command==='status'){
   const store=new JobStore(config.statePath);try{console.log(JSON.stringify(store.rows().map(({key,state,code,updatedAt})=>({key,state,code,updatedAt})),null,2));}finally{store.close();}
  }else if(command==='preflight')console.log(JSON.stringify(await createCli({chainId:config.chainId}).preflight(config),null,2));
  else{
   const abort=new AbortController();process.once('SIGTERM',()=>abort.abort());process.once('SIGINT',()=>abort.abort());
   await runWorker(config,{signal:abort.signal});
  }
 }catch(error){console.error(error instanceof SyntaxError?'Invalid config JSON.':error.message);process.exitCode=1;}
}
