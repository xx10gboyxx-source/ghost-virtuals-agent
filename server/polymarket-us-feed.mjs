import {readLimitedText} from './request-security.mjs';

// Public, unsigned US market data only. No exchange order or credential method exists.
export const POLYMARKET_US_API='https://gateway.polymarket.us';
export const POLYMARKET_US_LINK='https://polymarket.us/';
export const US_PAGE_SIZE=12;
export const US_CRYPTO_PAGE_SIZE=100;
export const US_CRYPTO_MAX_PAGES=3;
export const usSlug=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,179}$/.test(value);
const number=value=>(typeof value==='number'||typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value))&&Number.isFinite(Number(value))?Number(value):null;
const price=px=>px?.currency==='USD'?number(px.value):null;
const rounded=value=>Math.round(value*1e8)/1e8;
const timestamp=value=>{
 const match=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!match)return NaN;
 const [year,month,day,hour,minute,second]=match.slice(1).map(Number),leap=year%4===0&&(year%100!==0||year%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 return month>=1&&month<=12&&day>=1&&day<=days[month-1]&&hour<=23&&minute<=59&&second<=59?Date.parse(value):NaN;
};
const CRYPTO_WINDOW=15*60*1000;
function crypto15Terms(raw){
 const t=raw?.assetPriceTerms,startAt=timestamp(t?.windowStart),endAt=timestamp(t?.windowEnd);
 // horizon and slugs are display identifiers, never evidence of duration or asset.
 if(t?.marketType!=='ASSET_PRICE_MARKET_TYPE_UP_DOWN'||t?.asset?.assetClass!=='ASSET_CLASS_CRYPTO'||t.asset.symbol!=='btc'||t.indexSymbol!=='BRTI'||!Number.isFinite(startAt)||!Number.isFinite(endAt)||endAt-startAt!==CRYPTO_WINDOW)return null;
 const reference=price(t.priceToBeat);
 // A newly opened window can lack its reference temporarily. Keep it visible for WAIT.
 return {asset:'btc',indexSymbol:'BRTI',startAt,endAt,priceToBeat:reference!==null&&reference>0?reference:null};
}
function supportedPath(path){
 if(/^\/v1\/(?:markets\/[a-z0-9-]+\/(?:book|settlement)|market\/slug\/[a-z0-9-]+)$/.test(path))return true;
 if(!path.startsWith('/v1/markets?')||path.includes('#'))return false;
 const params=new URLSearchParams(path.slice('/v1/markets?'.length)),seen=new Set();
 if(!params.size)return false;
 for(const [key,value] of params){
  if(seen.has(key))return false;seen.add(key);
  if(key==='limit'){if(!/^\d+$/.test(value)||+value<1||+value>US_CRYPTO_PAGE_SIZE)return false;}
  else if(key==='offset'){if(!/^\d+$/.test(value)||+value>100000)return false;}
  else if(['active','closed','archived'].includes(key)){if(!['true','false'].includes(value))return false;}
  else if(key==='categories'){if(value!=='crypto')return false;}
  else if(['endDateMin','endDateMax'].includes(key)){if(!Number.isFinite(timestamp(value)))return false;}
  else return false;
 }
 return true;
}
export function normalizeUSMarket(raw){
 if(!usSlug(raw?.slug))throw new Error('Market identity is invalid.');
 const sides=Array.isArray(raw.marketSides)?raw.marketSides:[];
 const binary=Array.isArray(sides)&&sides.length===2&&[true,false].every(long=>sides.filter(s=>s?.long===long&&s.identifier===raw.slug).length===1);
 const name=sides.find(s=>s?.long===true)?.team?.name;
 const title=String(raw.question||raw.title||raw.slug)+(name?' · '+String(name):'');
 const typedCrypto=raw.assetPriceTerms?.asset?.assetClass==='ASSET_CLASS_CRYPTO';
 return {slug:raw.slug,title:title.slice(0,300),active:raw.active===true&&raw.closed===false&&raw.archived===false&&raw.status==='MARKET_STATUS_OPEN',
  resolved:raw.status==='MARKET_STATUS_RESOLVED'&&raw.closed===true,closeAt:typedCrypto?timestamp(raw.assetPriceTerms.windowEnd):Date.parse(raw.endDate),crypto15:crypto15Terms(raw),
  binary:binary&&sides.every(s=>s.tradable===true),feeCoefficient:number(raw.feeCoefficient),minQuantity:number(raw.minimumTradeQty),tickSize:number(raw.orderPriceMinTickSize)};
}
export function normalizeUSBook(raw,slug,receivedAt=Date.now()){
 const b=raw?.marketData;
 if(b?.marketSlug!==slug)throw new Error('Order book identity does not match the market.');
 const levels=(rows,descending)=>{
  if(!Array.isArray(rows)||rows.length>500)throw new Error('Order book depth is incomplete.');
  const seen=new Set();
  const values=rows.map(row=>{
   const p=price(row.px),quantity=number(row.qty);
   if(p===null||p<=0||p>=1||quantity===null||quantity<0||seen.has(p))throw new Error('Order book price, currency or size is invalid.');
   seen.add(p);return {price:p,quantity};
  }).filter(x=>x.quantity>0);
  return values.sort((a,c)=>descending?c.price-a.price:a.price-c.price);
 };
 const bids=levels(b.bids,true),offers=levels(b.offers,false);
 if(bids.length&&offers.length&&bids[0].price>=offers[0].price)throw new Error('Locked or crossed order book; refresh before simulating.');
 return {valid:true,bookOpen:b.state==='MARKET_STATE_OPEN',sourceAt:Date.parse(b.transactTime),receivedAt,
  yesAsk:offers[0]?.price??null,noAsk:bids.length?rounded(1-bids[0].price):null,
  yesBid:bids[0]?.price??null,noBid:offers.length?rounded(1-offers[0].price):null,
  yesDepth:offers,noDepth:bids.map(x=>({price:rounded(1-x.price),quantity:x.quantity})),
  yesExitDepth:bids,noExitDepth:offers.map(x=>({price:rounded(1-x.price),quantity:x.quantity})),bookState:b.state};
}
export async function mapUSReads(values,read,concurrency=4){
 const result=new Array(values.length);let next=0;
 await Promise.all(Array.from({length:Math.min(concurrency,values.length)},async()=>{while(next<values.length){const i=next++;result[i]=await read(values[i]);}}));return result;
}
export function createPolymarketUSFeed({fetcher=(...args)=>globalThis.fetch(...args),now=()=>Date.now()}={}){
 const pending=new Map(),metadata=new Map();
 // Coalesce simultaneous reads, but a long-lived caller must get a new snapshot.
 const cached=(cache,key)=>{const item=cache.get(key);return item&&(item.inFlight||now()-item.at>=0&&now()-item.at<2000)?item.value:null;};
 async function get(path){
  if(!supportedPath(path))throw new Error('Unsupported US market-data path.');
  const previous=cached(pending,path);if(previous)return previous;
  const item={at:now(),inFlight:true};
  const value=(async()=>{
   const controller=new AbortController();let timer;
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Polymarket US data request timed out.'));},6000);});
   const discard=async response=>{try{await response.body?.cancel();}catch{}};
   try{
    return await Promise.race([deadline,(async()=>{
     for(let attempt=0;attempt<2;attempt++){
      controller.signal.throwIfAborted();
      const headers=attempt?{Accept:'application/json','Cache-Control':'no-cache, max-age=0',Pragma:'no-cache'}:{Accept:'application/json'};
      const response=await fetcher(POLYMARKET_US_API+path,{method:'GET',redirect:'manual',cache:'no-store',headers,signal:controller.signal});
      if(controller.signal.aborted){await discard(response);controller.signal.throwIfAborted();}
      if(!response.ok){
       await discard(response);
       throw Object.assign(new Error(response.status===429?'Polymarket US data is rate limited. Retry after the next scan interval.':'Polymarket US data unavailable ('+response.status+').'),{status:response.status});
      }
      const age=number(response.headers.get('age')??'0'),date=Date.parse(response.headers.get('date'));
      if(age===null||age>15||Number.isFinite(date)&&Math.abs(now()-date)>30000){
       await discard(response);
       // A cache may honor explicit revalidation. Try once on the same public
       // GET within the original deadline; unchanged stale data still fails.
       if(attempt===0)continue;
       throw new Error('Polymarket US response is stale.');
      }
      return JSON.parse(await readLimitedText(response,1000000));
     }
    })()]);
   }finally{clearTimeout(timer);controller.abort();item.inFlight=false;item.at=now();}
  })();item.value=value;pending.set(path,item);return value;
 }
 async function meta(slug){
  if(!usSlug(slug))throw new Error('Invalid market selection.');
  const previous=cached(metadata,slug);if(previous)return previous;
  const value=(async()=>{
   const raw=await get('/v1/market/slug/'+slug),m=normalizeUSMarket(raw.market);
   if(m.slug!==slug)throw new Error('Market response identity mismatch.');return m;
  })();metadata.set(slug,{at:now(),value});return value;
 }
 async function market(slug){
  let m;
  try{
   if(!usSlug(slug))throw new Error('Invalid market selection.');
   // Independent public reads overlap, but neither can authorize a partial
   // market. Normalize the book on arrival so metadata waits never refresh it.
   const [terms,book]=await Promise.allSettled([meta(slug),get('/v1/markets/'+slug+'/book').then(raw=>normalizeUSBook(raw,slug,now()))]);
   if(terms.status==='rejected')throw terms.reason;m=terms.value;
   if(book.status==='rejected')throw book.reason;
   return {...m,...book.value};
  }
  catch(error){return {...m,slug,title:m?.title||slug,valid:false,reason:error.message,receivedAt:now()};}
 }
 return {
  async board(offset=0){
   if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new Error('Invalid market page.');
   const data=await get('/v1/markets?limit='+US_PAGE_SIZE+'&offset='+offset+'&active=true&closed=false&archived=false');
   if(!Array.isArray(data.markets)||data.markets.length>US_PAGE_SIZE)throw new Error('Market listing is invalid.');
   const slugs=[];
   for(const raw of data.markets){const m=normalizeUSMarket(raw);if(slugs.includes(m.slug))throw new Error('Duplicate market listing.');metadata.set(m.slug,{at:now(),value:Promise.resolve(m)});slugs.push(m.slug);}
   return {markets:await mapUSReads(slugs,market),offset,limit:US_PAGE_SIZE,hasMore:slugs.length===US_PAGE_SIZE,fetchedAt:now()};
  },
  async crypto15({includeUpcoming=true}={}){
   try{
    const at=now(),found=[],seen=new Set();let complete=false;
    for(let page=0;page<US_CRYPTO_MAX_PAGES;page++){
     // API endDate can be 30 minutes after the measurement window. Filter broadly,
     // then use the typed window for eligibility; never trade the extra 30 minutes.
     const query=new URLSearchParams({limit:String(US_CRYPTO_PAGE_SIZE),offset:String(page*US_CRYPTO_PAGE_SIZE),categories:'crypto',active:'true',closed:'false',archived:'false',endDateMin:new Date(at).toISOString(),endDateMax:new Date(at+4*CRYPTO_WINDOW).toISOString()});
     const data=await get('/v1/markets?'+query);
     if(!Array.isArray(data.markets)||data.markets.length>US_CRYPTO_PAGE_SIZE)throw new Error('Crypto market listing is invalid.');
     for(const raw of data.markets){
      const m=normalizeUSMarket(raw);
      if(seen.has(m.slug))throw new Error('Crypto discovery returned duplicate markets; wait for a consistent listing.');
      seen.add(m.slug);
      if(m.active&&m.crypto15&&m.crypto15.endAt>at&&m.crypto15.startAt<=at+CRYPTO_WINDOW)found.push(m);
     }
     if(data.markets.length<US_CRYPTO_PAGE_SIZE){complete=true;break;}
    }
    if(!complete)throw new Error('Crypto discovery reached its pagination limit; wait for a complete market listing.');
    found.sort((a,b)=>a.crypto15.startAt-b.crypto15.startAt);
    let previousEnd=-Infinity;
    for(const m of found){
     if(m.crypto15.startAt<previousEnd)throw new Error('Crypto discovery found ambiguous BTC windows; wait for a unique verified market.');
     previousEnd=m.crypto15.endAt;metadata.set(m.slug,{at:now(),value:Promise.resolve(m)});
    }
    // Validate the complete listing first. Trading needs only started windows;
    // chart callers keep upcoming windows without making bots await their books.
    const current=found.filter(m=>m.crypto15.endAt>now()&&(includeUpcoming||m.crypto15.startAt<=now())).sort((a,b)=>a.crypto15.startAt-b.crypto15.startAt);
    if(!current.length)return {markets:[],fetchedAt:now(),reason:!includeUpcoming&&found.some(m=>m.crypto15.startAt>now())?'The next verified BTC/BRTI 15-minute window has not started. Checks will continue for its opening.':'No active, verified BTC/BRTI 15-minute window is available. Wait for Polymarket US to publish the current or next window.'};
    const markets=(await mapUSReads(current.map(m=>m.slug),market)).filter(m=>m.crypto15?.endAt>now());
    return {markets,fetchedAt:now(),...(!markets.length?{reason:'The discovered 15-minute window ended or its terms changed while refreshing. Wait for the next verified window.'}:{})};
   }catch(error){return {markets:[],fetchedAt:now(),reason:error.message};}
  },
  markets:slugs=>mapUSReads([...new Set(slugs)],market),
  async settlement(slug){
   // A metadata resolution AND the dedicated settlement endpoint are required.
   // A closed book, stats.settlementPx or a model forecast alone is not a result.
   const m=await meta(slug);if(!m.resolved)return null;
   const result=await get('/v1/markets/'+slug+'/settlement'),p=number(result.settlement);
   if(result.slug!==slug||p===null||p<0||p>1)throw new Error('Official settlement is incomplete or mismatched.');
   return {slug,price:p,resolved:true};
  }
 };
}
