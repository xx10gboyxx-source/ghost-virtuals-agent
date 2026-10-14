import {readLimitedText} from './request-security.mjs';

// TOSHI's published Base contract. Discovery chooses data sources, not trades;
// every candidate must still pass the separate market/security strategy gates.
export const DEFAULT_TOKENS=Object.freeze(['0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4']);
const API='https://api.geckoterminal.com/api/v2/networks/base/tokens/';
const SUCCESS_TTL=15*60000,RETRY_MIN=60000,MAX_BYTES=2000000;
const address=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value)&&!/^0x0{40}$/.test(value)?value.toLowerCase():null;
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:
 typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)&&Number.isFinite(Number(value))?Number(value):null;
const later=(at,delay)=>Math.min(Number.MAX_SAFE_INTEGER,at+delay);
class DiscoveryError extends Error{
 constructor(code,retryAt=null){super(code);this.code=code;this.retryAt=retryAt;}
}
function tokenRelationship(data){
 if(data?.type!=='token'||typeof data.id!=='string'||!data.id.startsWith('base_'))return null;
 return address(data.id.slice(5));
}
function choosePool(raw,token){
 if(!Array.isArray(raw?.data)||raw.data.length>20)throw new DiscoveryError('DISCOVERY_INVALID_RESPONSE');
 const seen=new Set(),candidates=[];
 for(const row of raw.data){
  const pool=address(row?.attributes?.address),liquidity=numeric(row?.attributes?.reserve_in_usd);
  // Conventional EVM pool contracts only. V4 32-byte pool IDs, native-token
  // zero addresses and quote-side matches are unsupported by the data feed.
  if(!pool||row?.type!=='pool'||typeof row.id!=='string'||!row.id.startsWith('base_')||row.id.toLowerCase()!==`base_${pool}`)continue;
  if(seen.has(pool))throw new DiscoveryError('DISCOVERY_INVALID_RESPONSE');
  seen.add(pool);
  const base=tokenRelationship(row.relationships?.base_token?.data),quote=tokenRelationship(row.relationships?.quote_token?.data);
  if(base!==token||!quote||quote===token||liquidity===null||liquidity<=0)continue;
  candidates.push({pool,liquidity});
 }
 // Stable address ordering breaks ties; the first page is provider-ranked.
 // This is the greatest reported liquidity among supported rows on page one,
 // not a claim that the pool is best, secure, or globally the most liquid.
 candidates.sort((a,b)=>b.liquidity-a.liquidity||a.pool.localeCompare(b.pool));
 return candidates[0]?.pool??null;
}
function retryTime(header,at){
 const seconds=typeof header==='string'&&/^\d+$/.test(header)?Number(header):NaN;
 const absolute=typeof header==='string'&&!Number.isFinite(seconds)?Date.parse(header):NaN;
 const wait=Number.isFinite(seconds)?seconds*1000:Number.isFinite(absolute)?absolute-at:RETRY_MIN;
 return later(at,Math.max(RETRY_MIN,Number.isFinite(wait)?wait:RETRY_MIN));
}

export function createPoolDiscovery({tokens=DEFAULT_TOKENS,fetcher=globalThis.fetch,now=Date.now}={}){
 if(!Array.isArray(tokens)||tokens.length>2||tokens.some(token=>!address(token)))throw new Error('Select at most two nonzero Base token contracts.');
 const selected=tokens.map(address);
 if(new Set(selected).size!==selected.length)throw new Error('Base token contracts must be unique.');
 if(typeof fetcher!=='function'||typeof now!=='function')throw new Error('Invalid pool discovery configuration.');
 let cache=null,inFlight=null,lastAt=null,clockEpoch=0;
 const result=(status,code,checkedAt,retryAt,pools=[])=>({pools,tokens:[...selected],source:'token-pools',checkedAt,retryAt,status,code});
 function clock(){
  let at;try{at=now();}catch{throw new DiscoveryError('CLOCK_INVALID');}
  if(!Number.isSafeInteger(at)||at<0)throw new DiscoveryError('CLOCK_INVALID');
  if(lastAt!==null&&at<lastAt)throw new DiscoveryError('CLOCK_REGRESSED');
  lastAt=at;return at;
 }
 function clockWait(code){
  clockEpoch++;
  cache=result('WAIT',code,lastAt,lastAt===null?null:later(lastAt,RETRY_MIN));
  return cache;
 }
 async function get(token,at){
  const controller=new AbortController();let timer,response;
  const cancel=async()=>{try{await response?.body?.cancel();}catch{}};
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new DiscoveryError('DISCOVERY_UNAVAILABLE'));},12000);});
  try{
   return await Promise.race([deadline,(async()=>{
    response=await fetcher(API+token+'/pools?include=base_token,quote_token&page=1',{method:'GET',headers:{Accept:'application/json'},redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal});
    if(controller.signal.aborted){await cancel();controller.signal.throwIfAborted();}
    if(response.status===429){const retryAt=retryTime(response.headers.get('retry-after'),at);await cancel();throw new DiscoveryError('DISCOVERY_RATE_LIMITED',retryAt);}
    if(!response.ok||response.redirected){await cancel();throw new DiscoveryError('DISCOVERY_UNAVAILABLE');}
    return JSON.parse(await readLimitedText(response,MAX_BYTES));
   })()]);
  }finally{clearTimeout(timer);controller.abort();}
 }
 async function run(start,epoch){
  try{
   const pools=[];
   for(const token of selected){
    const payload=await get(token,clock());clock();
    if(epoch!==clockEpoch)return cache;
    const pool=choosePool(payload,token);
    if(pool===null)throw new DiscoveryError('NO_SUPPORTED_POOLS');
    if(pools.includes(pool))throw new DiscoveryError('DISCOVERY_INVALID_RESPONSE');
    pools.push(pool);
   }
   const at=clock();
   if(epoch!==clockEpoch)return cache;
   cache=selected.length?result('OK','POOLS_DISCOVERED',start,later(start,SUCCESS_TTL),pools):result('WAIT','NO_TOKENS_CONFIGURED',start,later(at,RETRY_MIN));
  }catch(error){
   if(epoch!==clockEpoch)return cache;
   if(error instanceof DiscoveryError&&['CLOCK_INVALID','CLOCK_REGRESSED'].includes(error.code))return clockWait(error.code);
   let at;try{at=clock();}catch(error){return clockWait(error.code);}
   const code=error instanceof DiscoveryError?error.code:'DISCOVERY_UNAVAILABLE';
   cache=result('WAIT',code,start,Math.max(later(at,RETRY_MIN),error instanceof DiscoveryError?error.retryAt??0:0));
  }
  return cache;
 }
 return {async discover(){
  let at;try{at=clock();}catch(error){return structuredClone(clockWait(error.code));}
  if(cache&&cache.retryAt!==null&&at<cache.retryAt)return structuredClone(cache);
  if(!inFlight){
   inFlight=run(at,clockEpoch);
   inFlight.finally(()=>{inFlight=null;}).catch(()=>{});
  }
  // Cached candidates never survive a failed refresh or invalid clock. Each
  // caller gets an isolated copy; concurrent refreshes make one bounded scan.
  return structuredClone(await inFlight);
 }};
}
