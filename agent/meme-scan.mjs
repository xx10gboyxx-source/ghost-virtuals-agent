import {pathToFileURL} from 'node:url';
import {createBaseMemeFeed} from '../server/base-meme-feed.mjs';
import {evaluateMeme,STRATEGIES} from '../server/meme-strategy.mjs';

// Read-only job payload adapter. It does not accept ACP jobs, sign or deliver them.
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/i.test(value)&&!/^0x0{40}$/i.test(value);
const epoch=value=>Number.isSafeInteger(value)&&value>0?value:null;
function emptyReport(at,code,reason,poolAddress=null,strategy=null,status='WAIT'){
 return {report:{mode:'research',liveOrders:false,chainId:8453,timeframe:'5m',poolAddress,tokenAddress:null,strategy,
  status,code,reason,checkedAt:epoch(at),evidence:{quoteObservedAt:null,securityCheckedAt:null,latestClosedCandleAt:null},metrics:{},plan:null}};
}

export async function scanMemePool(input,{feedFactory=createBaseMemeFeed,now=Date.now}={}){
 const at=now();
 if(epoch(at)===null)return emptyReport(at,'INVALID_CLOCK','A valid current clock is required.');
 const valid=input!==null&&typeof input==='object'&&!Array.isArray(input)&&
  Object.keys(input).every(key=>['poolAddress','strategy'].includes(key))&&address(input.poolAddress)&&
  (!Object.hasOwn(input,'strategy')||STRATEGIES.includes(input.strategy));
 if(!valid)return emptyReport(at,'INVALID_REQUEST','Supply one nonzero Base poolAddress and optional strategy volume-breakout or trend-pullback; no other fields are accepted.');
 const poolAddress=input.poolAddress.toLowerCase(),strategy=input.strategy??'volume-breakout';
 let snapshots;
 try{snapshots=await feedFactory({pools:[poolAddress],now}).snapshots();}
 catch{return emptyReport(now(),'FEED_UNAVAILABLE','Market data is unavailable. No signal or order was created.',poolAddress,strategy);}
 const checkedAt=now();
 if(!Array.isArray(snapshots)||snapshots.length!==1)
  return emptyReport(checkedAt,'FEED_UNAVAILABLE','Exactly one requested pool snapshot is required.',poolAddress,strategy);
 const snapshot=snapshots[0];
 if(!address(snapshot?.poolAddress)||snapshot.poolAddress.toLowerCase()!==poolAddress)
  return emptyReport(checkedAt,'POOL_MISMATCH','Returned pool does not match the requested pool.',poolAddress,strategy,'BLOCKED');
 const decision=evaluateMeme(snapshot,{strategy,now:checkedAt});
 const latestClosed=Array.isArray(snapshot.candles)?snapshot.candles.filter(c=>epoch(c?.time)&&c.time<Math.floor(checkedAt/300000)*300).at(-1):null;
 return {report:{...emptyReport(checkedAt,'','',poolAddress,strategy).report,...decision,
  tokenAddress:address(snapshot.tokenAddress)?snapshot.tokenAddress.toLowerCase():null,
  evidence:{quoteObservedAt:epoch(snapshot.observedAt),securityCheckedAt:epoch(snapshot.security?.checkedAt),latestClosedCandleAt:epoch(latestClosed?.time*1000)}}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let result;
 try{
  let bytes=0;const chunks=[];
  for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>4096)throw new Error('Input limit');chunks.push(chunk);}
  result=await scanMemePool(JSON.parse(Buffer.concat(chunks).toString('utf8')));
 }catch{result=emptyReport(Date.now(),'INVALID_INPUT','Provide a JSON object of at most 4096 bytes on standard input.');}
 console.log(JSON.stringify(result,null,2));
 if(['INVALID_INPUT','INVALID_REQUEST','INVALID_CLOCK','FEED_UNAVAILABLE','POOL_MISMATCH'].includes(result.report.code))process.exitCode=1;
}
