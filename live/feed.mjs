import {createBaseMemeFeed} from '../server/base-meme-feed.mjs';
import {readLimitedText} from '../server/request-security.mjs';

const WETH='0x4200000000000000000000000000000000000006';
const PRICE_URL='https://api.geckoterminal.com/api/v2/simple/networks/base/token_price/'+WETH;
export function createLiveFeed({poolAddress,clock=Date.now,fetcher=globalThis.fetch}={}){
 const feed=createBaseMemeFeed({pools:[poolAddress],now:clock,fetcher});let cached=null,cooldown=0;
 return {async snapshots(){
  const rows=await feed.snapshots(),at=clock();
  for(const row of rows){
   if(row.quoteTokenAddress===WETH&&row.quotePriceUsd>0){row.nativePriceUsd=row.quotePriceUsd;row.nativeObservedAt=row.observedAt;continue;}
   if(!cached||at-cached.at>=60000){
    if(at<cooldown)throw new Error('Native price cooldown.');
    // Reserve before I/O: failures are bounded too.
    cooldown=at+60000;
    const response=await fetcher(PRICE_URL,{method:'GET',credentials:'omit',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
    if(response.status===429){const retry=response.headers.get('retry-after');const wait=/^\d+$/.test(retry??'')?Number(retry)*1000:Date.parse(retry??'')-at;cooldown=Math.min(Number.MAX_SAFE_INTEGER,at+Math.max(60000,Number.isFinite(wait)?wait:60000));}
    if(!response.ok||response.redirected)throw new Error('Native price unavailable.');
    const data=JSON.parse(await readLimitedText(response,32000)),value=data?.data?.attributes?.token_prices?.[WETH];
    const price=typeof value==='number'?value:typeof value==='string'&&/^(?:\d+(?:\.\d+)?)(?:[eE][+-]?\d+)?$/.test(value)?Number(value):NaN;
    if(!Number.isFinite(price)||price<=0)throw new Error('Native price unavailable.');
    cached={at,price};
   }
   row.nativePriceUsd=cached.price;row.nativeObservedAt=cached.at;
  }
  return rows;
 }};
}
