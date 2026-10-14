import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCli,validateConfig} from '../agent/acp-cli.mjs';
import {createBaseMemeFeed} from '../server/base-meme-feed.mjs';
import {evaluateMeme} from '../server/meme-strategy.mjs';

// Read-only deployment evidence. Never starts a session, writes a ledger, invokes
// provider/client/trade commands, handles credentials, or infers readiness from cash.
export async function checkReadiness({pools=[],probeFeed=false,acpConfigPath=null,now=Date.now,
 nodeVersion=process.versions.node,feedFactory=createBaseMemeFeed,cliFactory=createCli}={}){
 const checks=[],add=(id,status,detail)=>checks.push({id,status,detail});
 const checkedAt=now();if(!Number.isSafeInteger(checkedAt)||checkedAt<=0)throw new Error('Invalid clock.');
 add('node',Number(nodeVersion.split('.')[0])>=24?'PASS':'BLOCKED','Node.js 24 or newer is required.');
 let feed;
 try{feed=feedFactory({pools,now});add('pool_configuration',pools.length?'PASS':'BLOCKED',pools.length?'Explicit Base pool configuration accepted.':'Select one or two exact Base pool contracts.');}
 catch{add('pool_configuration','BLOCKED','Pool configuration is invalid.');}
 if(probeFeed&&feed&&pools.length){
  try{
   const rows=await feed.snapshots();
   if(!Array.isArray(rows)||rows.length!==pools.length)throw new Error('Missing market evidence.');
   const decisions=rows.map(row=>evaluateMeme(row,{now:now()}));
   add('market_data',decisions.every(d=>d.status==='PASS')?'PASS':'BLOCKED',decisions.map(d=>d.code).join(', '));
  }catch{add('market_data','UNVERIFIED','Public market data could not be verified.');}
 }else add('market_data','UNVERIFIED','Use --feed for a current read-only market check.');
 if(acpConfigPath){
  try{
   const raw=readFileSync(acpConfigPath);if(raw.length>4096)throw new Error('Invalid configuration.');
   const config=validateConfig(JSON.parse(raw));
   await cliFactory({chainId:config.chainId}).preflight(config);
   add('acp_identity_offering','PASS','Reviewed CLI identity and research offering match; signer and delivery remain unverified.');
  }catch{add('acp_identity_offering','UNVERIFIED','ACP configuration, identity or offering could not be verified.');}
 }else add('acp_identity_offering','UNVERIFIED','Use --acp-config /private/worker.json on the intended host for read-only preflight.');
 add('hosted_delivery','UNVERIFIED','A running host, persistent storage, restart recovery and an authenticated completed ACP job must be observed.');
 add('live_execution','NOT_IMPLEMENTED','No constrained token-swap executor, balance/allowance checks or confirmed receipt reconciliation exists.');
 add('live_exits','NOT_IMPLEMENTED','Stops and targets are simulated; no real position monitoring and sell execution exists.');
 add('owner_trading_policy','UNVERIFIED','Real capital, token allowlist, signer scope and gas/loss limits need explicit configuration and validation.');
 return {schemaVersion:'1.0',agent:'GhOsT',checkedAt,status:'BLOCKED',readyForFunding:false,
  fundingAloneStartsTrading:false,liveOrders:false,checks,
  meaning:'Readiness evidence only. Passing research checks cannot enable real trading.'};
}

export async function main(args){
 let probeFeed=false,acpConfigPath=null;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--feed'&&!probeFeed)probeFeed=true;
  else if(args[i]==='--acp-config'&&!acpConfigPath&&args[i+1]&&!args[i+1].startsWith('--'))acpConfigPath=args[++i];
  else throw new Error('Usage: npm run readiness -- [--feed] [--acp-config /private/worker.json]');
 }
 const pools=(process.env.GHOST_BASE_POOLS||'').split(',').map(x=>x.trim()).filter(Boolean);
 return checkReadiness({pools,probeFeed,acpConfigPath});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main(process.argv.slice(2)).then(result=>{console.log(JSON.stringify(result,null,2));process.exitCode=result.readyForFunding?0:2;})
 .catch(()=>{console.error('Readiness check unavailable. Use --feed and/or --acp-config with a private configuration path.');process.exitCode=1;});
}
