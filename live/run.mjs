import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {privateKeyToAccount} from 'viem/accounts';
import {BaseSwapBroker} from './base-broker.mjs';
import {LiveAgent} from './agent.mjs';
import {createLiveFeed} from './feed.mjs';
import {validateLiveConfig} from './config.mjs';

export const USAGE='npm run live -- <check|start|run|once|status|pause|retry-exit> ./live-config.json [private-db-path]';
export function readConfig(path){
 const bytes=readFileSync(path);if(bytes.length>8192)throw new Error('Live configuration is too large.');
 return validateLiveConfig(JSON.parse(bytes));
}
export async function main(args,{env=process.env,print=x=>console.log(JSON.stringify(x,null,2)),signal}={}){
 const [command,path,dbPath,...extra]=args;
 if(extra.length||!['check','start','run','once','status','pause','retry-exit'].includes(command)||!path)throw new Error(USAGE);
 const config=readConfig(path),signing=['start','run','once'].includes(command);
 let account=config.walletAddress;
 if(signing){
  if(!/^0x[0-9a-fA-F]{64}$/.test(env.GHOST_LIVE_PRIVATE_KEY??''))throw new Error('Set GHOST_LIVE_PRIVATE_KEY locally in the runner environment.');
  account=privateKeyToAccount(env.GHOST_LIVE_PRIVATE_KEY);
  if(account.address.toLowerCase()!==config.walletAddress)throw new Error('The locally configured signing account does not match walletAddress.');
 }
 const rpcUrl=env.GHOST_BASE_RPC_URL??'https://mainnet.base.org';
 const url=new URL(rpcUrl);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Use an HTTPS Base RPC URL without embedded basic-auth credentials.');
 const broker=new BaseSwapBroker({rpcUrl,account,maxGasWei:config.maxGasWei,maxFeePerGasWei:config.maxFeePerGasWei});
 const agent=new LiveAgent(resolve(dbPath??`state/live-${config.walletAddress.slice(2)}-${config.poolAddress.slice(2)}.sqlite`),{
  config,broker,feed:createLiveFeed({poolAddress:config.poolAddress})
 });
 let stopped=false;
 const stop=()=>{stopped=true;};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);signal?.addEventListener('abort',stop,{once:true});
 try{
  if(command==='check'){
   const {wallet,market,...result}=await agent.check();print(result);return result;
  }
  if(command==='status'){const result=agent.status();print(result);return result;}
  if(command==='retry-exit'){const result=agent.retryExit();print(result);return result;}
  if(command==='pause'){const result=agent.pause();print(result);return result;}
  if(command==='start'){const result=await agent.start();print(result);return result;}
  if(!agent.status().initialized)print(await agent.start());
  do{
   try{print(await agent.cycle());}catch{print({mode:'live',code:'LIVE_CYCLE_UNAVAILABLE',message:'Check provider availability and private journal status. Pending transactions remain recorded.'});}
   if(command==='once'||stopped||signal?.aborted)break;
   await new Promise(resolve=>{
    const timer=setTimeout(done,15000);
    function done(){clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();}
    signal?.addEventListener('abort',done,{once:true});
   });
  }while(!stopped&&!signal?.aborted);
 }finally{
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);signal?.removeEventListener('abort',stop);agent.close();
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main(process.argv.slice(2)).catch(()=>{console.error(`Live command could not complete. Check your local config, signer, RPC and journal. Usage: ${USAGE}`);process.exitCode=1;});
}
