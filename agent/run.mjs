import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {GhostRuntime} from './runtime.mjs';

export function configFromEnv(env){
 const pools=env.GHOST_BASE_POOLS?.trim(),tokens=env.GHOST_BASE_TOKENS?.trim(),strategy=env.GHOST_STRATEGY?.trim();
 if(pools&&tokens)throw new Error('Choose GHOST_BASE_POOLS or GHOST_BASE_TOKENS, not both.');
 if(!pools&&!tokens&&!strategy)return undefined;
 return {...(strategy?{strategy}:{}),...((pools||tokens)?{selection:pools?'pools':'tokens',addresses:(pools||tokens).split(',').map(x=>x.trim())}:{})};
}
export async function main(args,{env=process.env,write=line=>process.stdout.write(JSON.stringify(line)+'\n')}={}){
 const [command='run',path=env.GHOST_STATE_PATH||'./state/ghost-agent.sqlite']=args;
 if(args.length>2||!['run','once','status','reports','pause','resume'].includes(command))throw new Error('Use run, once, status, reports, pause or resume [database].');
 const runtime=new GhostRuntime(path,{config:configFromEnv(env)}),abort=new AbortController();let stopped=false;
 const stop=()=>{stopped=true;runtime.stop();abort.abort();};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{
  if(command==='status')return runtime.status();
  if(command==='reports')return runtime.reports();
  if(command==='pause'||command==='resume')return await runtime.control(command);
  if(command==='once')return await runtime.cycle();
  write({agent:'GhOsT',mode:'simulation',liveOrders:false,walletRequired:false,message:'Continuous research started. First new ledger receives simulated capital; saved pause, expiry and risk locks are preserved.'});
  while(!stopped){
   try{write(await runtime.cycle());}catch(error){if(!stopped)throw error;}
   if(!stopped){const wait=Math.max(1000,runtime.status().nextCycleAt-Date.now());try{await sleep(wait,undefined,{signal:abort.signal});}catch{if(!stopped)throw new Error('Runtime wait interrupted.');}}
  }
  return {agent:'GhOsT',mode:'simulation',liveOrders:false,status:'STOPPED',message:'Saved simulation and research records retained.'};
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);runtime.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2))).catch(error=>{console.error(JSON.stringify({status:'ERROR',message:error.message}));process.exitCode=1;});
}
