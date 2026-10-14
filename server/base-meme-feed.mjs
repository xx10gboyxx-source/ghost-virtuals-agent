import {readLimitedText} from './request-security.mjs';
import {RISK_FLAGS} from './meme-strategy.mjs';

// Read-only public data for caller-selected Base pools. This feed discovers no
// investments, holds no credentials, and has no signing or order API.
const GECKO='https://api.geckoterminal.com/api/v2/networks/base/pools/';
const GOPLUS='https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=';
const SNAPSHOT_TTL=60000,SECURITY_TTL=300000,REQUEST_LIMIT=8,MAX_BYTES=2000000;
const address=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value)?value.toLowerCase():null;
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:
 typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)&&Number.isFinite(Number(value))?Number(value):null;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=()=>{throw new Error('Base market data unavailable.');};
const flags=['is_open_source',...RISK_FLAGS,'buy_tax','sell_tax'];

function timestamp(value){
 const match=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!match)return null;
 const [year,month,day,hour,minute,second]=match.slice(1).map(Number),leap=year%4===0&&(year%100!==0||year%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31],at=Date.parse(value);
 return month>=1&&month<=12&&day>=1&&day<=days[month-1]&&hour<=23&&minute<=59&&second<=59&&Number.isFinite(at)?at:null;
}
function relationship(value){
 if(value?.type!=='token'||typeof value.id!=='string'||!value.id.startsWith('base_'))fail();
 return address(value.id.slice(5))||fail();
}
function normalizePool(raw,pool,at){
 const data=raw?.data,a=data?.attributes;
 if(data?.type!=='pool'||typeof data.id!=='string'||data.id.toLowerCase()!==`base_${pool}`||address(a?.address)!==pool)fail();
 const token=relationship(data.relationships?.base_token?.data),quote=relationship(data.relationships?.quote_token?.data);
 if(token===quote||!Array.isArray(raw.included)||raw.included.length>20)fail();
 for(const wanted of [token,quote]){
  const matches=raw.included.filter(row=>typeof row?.id==='string'&&row.id.toLowerCase()===`base_${wanted}`);
  if(matches.length!==1||matches[0].type!=='token'||address(matches[0].attributes?.address)!==wanted)fail();
 }
 const priceUsd=numeric(a.base_token_price_usd),liquidityUsd=numeric(a.reserve_in_usd),volume24hUsd=numeric(a.volume_usd?.h24),poolCreatedAt=timestamp(a.pool_created_at);
 if(priceUsd===null||priceUsd<=0||liquidityUsd===null||liquidityUsd<0||volume24hUsd===null||volume24hUsd<0||poolCreatedAt===null||poolCreatedAt<0||poolCreatedAt>at)fail();
 return {chainId:8453,tokenAddress:token,poolAddress:pool,observedAt:at,priceUsd,liquidityUsd,volume24hUsd,poolCreatedAt,quote};
}
function normalizeCandles(raw,token,quote){
 const rows=raw?.data?.attributes?.ohlcv_list;
 if(raw?.data?.type!=='ohlcv_request_response'||address(raw?.meta?.base?.address)!==token||address(raw?.meta?.quote?.address)!==quote||!Array.isArray(rows)||rows.length>100)fail();
 const seen=new Set();
 return rows.map(row=>{
  if(!Array.isArray(row)||row.length!==6||!row.every(value=>typeof value==='number'&&Number.isFinite(value)))fail();
  const [time,open,high,low,close,volume]=row;
  if(!Number.isSafeInteger(time)||time<0||seen.has(time)||Math.min(open,high,low,close)<=0||volume<0||high<Math.max(open,low,close)||low>Math.min(open,high,close))fail();
  seen.add(time);return {time,open,high,low,close,volume};
 }).sort((a,b)=>a.time-b.time);
}
function concentration(raw){
 const count=numeric(raw.holder_count),holders=raw.holders;
 if(!Number.isSafeInteger(count)||count<1||!Array.isArray(holders)||holders.length<Math.min(10,count)||holders.length>count||holders.length>1000)return null;
 const seen=new Set(),values=[];
 for(const holder of holders){
  const identity=address(holder?.address),percent=numeric(holder?.percent);
  if(!identity||seen.has(identity)||percent===null||percent<0||percent>1)return null;
  seen.add(identity);values.push(percent);
 }
 // No LP, burn-address or contract exclusions: those need independently
 // verified classification. A truncated or inconsistent list is unknown.
 const total=values.reduce((sum,value)=>sum+value,0);
 if(total>1+1e-9)return null;
 // GoPlus returns the top ten. A complete list must cover total supply;
 // allow 0.0001 percentage-point rounding, never treat missing supply as safe.
 if(holders.length===count&&Math.abs(total-1)>1e-6)return null;
 return Math.min(100,values.sort((a,b)=>b-a).slice(0,10).reduce((sum,value)=>sum+value,0)*100);
}
function normalizeSecurity(raw,token,at){
 if(raw?.code!==1||!object(raw.result))throw new Error('Unavailable security data.');
 const matches=Object.keys(raw.result).filter(key=>address(key)===token);
 if(matches.length!==1||!object(raw.result[matches[0]]))throw new Error('Unavailable security data.');
 const record=raw.result[matches[0]],selected={};
 for(const key of flags)if(typeof record[key]==='string'&&record[key].length<=64)selected[key]=record[key];
 return {checkedAt:at,chainId:8453,tokenAddress:token,source:'goplus',flags:selected,top10HolderPct:concentration(record)};
}

export function createBaseMemeFeed({pools=[],fetcher=globalThis.fetch,now=Date.now}={}){
 if(!Array.isArray(pools)||pools.length>2||pools.some(pool=>!address(pool)))throw new Error('Select at most two full Base pool addresses.');
 const selected=pools.map(address);
 if(new Set(selected).size!==selected.length)throw new Error('Base pool addresses must be unique.');
 if(typeof fetcher!=='function'||typeof now!=='function')throw new Error('Invalid Base feed configuration.');
 const marketCache=new Map(),securityCache=new Map();let requests=[],cooldownUntil=0,inFlight=null;
 const clock=()=>{const at=now();if(!Number.isSafeInteger(at)||at<0)fail();return at;};
 const fresh=(record,at,ttl)=>record&&at>=record.at&&at-record.at<ttl;
 async function get(url){
  const at=clock();requests=requests.filter(time=>at-time<60000);
  if(at<cooldownUntil||requests.length>=REQUEST_LIMIT)fail();
  requests.push(at);
  const controller=new AbortController();let timer,response;
  const discard=async()=>{try{await response?.body?.cancel();}catch{}};
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Data request timed out.'));},12000);});
  try{
   return await Promise.race([deadline,(async()=>{
    response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal});
    if(controller.signal.aborted){await discard();controller.signal.throwIfAborted();}
    if(response.status===429){
     const retry=response.headers.get('retry-after'),seconds=numeric(retry),date=timestamp(retry);
     // HTTP Retry-After may be an HTTP-date rather than ISO 8601.
     const httpDate=date??(typeof retry==='string'?Date.parse(retry):NaN);
     const wait=seconds!==null&&seconds>=0?seconds*1000:Number.isFinite(httpDate)?httpDate-clock():60000;
     cooldownUntil=Math.max(cooldownUntil,clock()+Math.max(60000,Number.isFinite(wait)?wait:60000));
    }
    if(!response.ok||response.redirected){await discard();fail();}
    return JSON.parse(await readLimitedText(response,MAX_BYTES));
   })()]);
  }finally{clearTimeout(timer);controller.abort();}
 }
 async function security(token){
  const at=clock(),previous=securityCache.get(token);
  if(fresh(previous,at,previous?.value===null?SNAPSHOT_TTL:SECURITY_TTL))return previous.value;
  let value=null;
  try{value=normalizeSecurity(await get(GOPLUS+token),token,at);}catch{/* Unknown security is never an all-clear. */}
  securityCache.set(token,{at,value});return value;
 }
 async function snapshot(pool){
  const at=clock(),previous=marketCache.get(pool);
  if(fresh(previous,at,SNAPSHOT_TTL))return previous.value;
  const {quote,...market}=normalizePool(await get(GECKO+pool+'?include=base_token,quote_token'),pool,at);
  const candles=normalizeCandles(await get(GECKO+pool+'/ohlcv/minute?aggregate=5&limit=100&currency=usd&token=base&include_empty_intervals=true'),market.tokenAddress,quote);
  const value={...market,candles,security:await security(market.tokenAddress)};
  marketCache.set(pool,{at,value});return value;
 }
 return {async snapshots(){
  if(!inFlight){
   inFlight=(async()=>{const rows=[];try{for(const pool of selected)rows.push(await snapshot(pool));return rows;}catch{fail();}})();
   inFlight.finally(()=>{inFlight=null;}).catch(()=>{});
  }
  // A caller cannot alter cache contents, and a mixed market failure returns
  // no partial scan. Security failures remain explicit null evidence.
  return structuredClone(await inFlight);
 }};
}
