import test from 'node:test';
import assert from 'node:assert/strict';
import {createBaseMemeFeed} from '../server/base-meme-feed.mjs';

const T=1791990000000;
const POOL='0x1111111111111111111111111111111111111111';
const POOL2='0x2222222222222222222222222222222222222222';
const TOKEN='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const QUOTE='0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const marketURL=pool=>`https://api.geckoterminal.com/api/v2/networks/base/pools/${pool}?include=base_token,quote_token`;
const candleURL=pool=>`https://api.geckoterminal.com/api/v2/networks/base/pools/${pool}/ohlcv/minute?aggregate=5&limit=100&currency=usd&token=base&include_empty_intervals=true`;
const securityURL=`https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${TOKEN}`;
const poolData=(pool=POOL)=>({data:{type:'pool',id:`base_${pool}`,attributes:{address:pool,base_token_price_usd:'0.001',reserve_in_usd:'200000',volume_usd:{h24:'500000'},pool_created_at:new Date(T-86400000).toISOString()},relationships:{base_token:{data:{id:`base_${TOKEN}`,type:'token'}},quote_token:{data:{id:`base_${QUOTE}`,type:'token'}}}},included:[TOKEN,QUOTE].map(address=>({id:`base_${address}`,type:'token',attributes:{address}}))});
const candles=()=>({data:{type:'ohlcv_request_response',attributes:{ohlcv_list:[[T/1000-300,1,2,.5,1.5,120],[T/1000-600,.8,1.2,.7,1,100]]}},meta:{base:{address:TOKEN},quote:{address:QUOTE}}});
const tokenSecurity=()=>({code:1,result:{[TOKEN]:{is_open_source:'1',is_honeypot:'0',cannot_buy:'0',cannot_sell_all:'0',is_mintable:'0',is_proxy:'0',transfer_pausable:'0',slippage_modifiable:'0',owner_change_balance:'0',hidden_owner:'0',is_blacklisted:'0',buy_tax:'0.01',sell_tax:'0.02',holder_count:'30',holders:Array.from({length:10},(_,i)=>({address:'0x'+(i+1).toString(16).padStart(40,'0'),percent:'0.02'})),token_name:'Untrusted label',unrelated:'not copied'}}});
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
function fixture(options={}){
 let at=T;const calls=[];
 const fetcher=async(url,init)=>{calls.push({url,init});if(options.respond)return options.respond(url,init,calls.length);if(url===securityURL)return json(tokenSecurity());if(url.includes('/ohlcv/'))return json(candles());return json(poolData(url.includes(POOL2)?POOL2:POOL));};
 return {feed:createBaseMemeFeed({pools:[POOL],fetcher,now:()=>at,...options.feed}),calls,time:value=>{at=value;}};
}

test('explicit allowlist is required; empty selection performs no request',async()=>{
 let reads=0;assert.deepEqual(await createBaseMemeFeed({fetcher:()=>{reads++;}}).snapshots(),[]);assert.equal(reads,0);
 for(const pools of [[POOL,POOL2,TOKEN],[POOL,POOL.toUpperCase()],['https://example.test'],[POOL+'?x=1'],'all'])assert.throws(()=>createBaseMemeFeed({pools}),/pool/i);
});
test('fixed unsigned Base requests produce typed snapshots and preserve raw security flags',async()=>{
 const h=fixture(),[row]=await h.feed.snapshots();
 assert.deepEqual(h.calls.map(x=>x.url),[marketURL(POOL),candleURL(POOL),securityURL]);
 for(const {init} of h.calls){assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.headers.Authorization,undefined);assert.ok(init.signal instanceof AbortSignal);}
 assert.equal(row.chainId,8453);assert.equal(row.poolAddress,POOL);assert.equal(row.tokenAddress,TOKEN);assert.equal(row.priceUsd,.001);assert.equal(row.liquidityUsd,200000);assert.equal(row.volume24hUsd,500000);assert.equal(row.poolCreatedAt,T-86400000);
 assert.equal(row.observedAt,T);assert.deepEqual(row.candles.map(x=>x.time),[T/1000-600,T/1000-300]);
 assert.equal(row.security.source,'goplus');assert.equal(row.security.chainId,8453);assert.equal(row.security.tokenAddress,TOKEN);assert.equal(row.security.checkedAt,T);assert.equal(row.security.flags.buy_tax,'0.01');assert.equal(row.security.flags.unrelated,undefined);assert.ok(Math.abs(row.security.top10HolderPct-20)<1e-10);
});
test('snapshot and security caches retain original evidence times and isolate caller mutations',async()=>{
 const h=fixture();const [first]=await h.feed.snapshots();first.priceUsd=999;first.security.flags.is_honeypot='1';h.time(T+59999);
 const [cached]=await h.feed.snapshots();assert.equal(cached.priceUsd,.001);assert.equal(cached.security.flags.is_honeypot,'0');assert.equal(cached.observedAt,T);assert.equal(cached.security.checkedAt,T);assert.equal(h.calls.length,3);
 h.time(T+60000);const [fresh]=await h.feed.snapshots();assert.equal(fresh.observedAt,T+60000);assert.equal(fresh.security.checkedAt,T);assert.equal(h.calls.length,5);
 h.time(T+300000);const [renewed]=await h.feed.snapshots();assert.equal(renewed.security.checkedAt,T+300000);assert.equal(h.calls.length,8);
});
test('concurrent scans coalesce and two explicit pools are fetched sequentially',async()=>{
 let inFlight=0,maxInFlight=0;
 const h=fixture({feed:{pools:[POOL,POOL2]},respond:async url=>{inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await new Promise(r=>setImmediate(r));inFlight--;return json(url===securityURL?tokenSecurity():url.includes('/ohlcv/')?candles():poolData(url.includes(POOL2)?POOL2:POOL));}});
 const [a,b]=await Promise.all([h.feed.snapshots(),h.feed.snapshots()]);assert.equal(a.length,2);assert.deepEqual(a,b);assert.equal(h.calls.length,5);assert.equal(maxInFlight,1);assert.notEqual(a,b);
});
test('pool, chain, included token, and OHLCV token identity mismatches fail closed',async()=>{
 for(const change of [x=>{x.data.id=`eth_${POOL}`;},x=>{x.data.attributes.address=POOL2;},x=>{x.data.relationships.base_token.data.id=`eth_${TOKEN}`;},x=>{x.included[0].attributes.address=QUOTE;},x=>{x.included.push(x.included[0]);}]){
  const p=poolData();change(p);const h=fixture({respond:()=>json(p)});await assert.rejects(h.feed.snapshots(),/^Error: Base market data unavailable\.$/);assert.equal(h.calls.length,1);
 }
 const c=candles();c.meta.base.address=QUOTE;const h=fixture({respond:url=>json(url.includes('/ohlcv/')?c:poolData())});await assert.rejects(h.feed.snapshots(),/Base market data unavailable/);
});
test('missing, empty, nonfinite and invalid market numbers do not become zero',async()=>{
 for(const value of [null,'',undefined,'NaN','0x10',true,'Infinity',-1]){
  const p=poolData();p.data.attributes.reserve_in_usd=value;const h=fixture({respond:()=>json(p)});await assert.rejects(h.feed.snapshots(),/Base market data unavailable/);
 }
 const p=poolData();p.data.attributes.pool_created_at='2026-02-30T00:00:00Z';await assert.rejects(fixture({respond:()=>json(p)}).feed.snapshots(),/Base market data unavailable/);
});
test('malformed, duplicate, negative, inconsistent and over-limit candles are rejected',async()=>{
 for(const change of [c=>{c.data.attributes.ohlcv_list[0][1]='1';},c=>{c.data.attributes.ohlcv_list.push(c.data.attributes.ohlcv_list[0]);},c=>{c.data.attributes.ohlcv_list[0][5]=-1;},c=>{c.data.attributes.ohlcv_list[0][2]=.1;},c=>{c.data.attributes.ohlcv_list=Array(101).fill([1,1,1,1,1,0]);},c=>{delete c.meta;}]){
  const c=candles();change(c);const h=fixture({respond:url=>json(url.includes('/ohlcv/')?c:poolData())});await assert.rejects(h.feed.snapshots(),/Base market data unavailable/);
 }
});
test('security failures, denied authentication and mismatched token keys return null',async()=>{
 for(const response of [()=>new Response('denied',{status:401}),()=>new Response('bad',{status:403}),()=>json({code:1,result:{[QUOTE]:tokenSecurity().result[TOKEN]}}),()=>json({code:0,result:{}}),()=>{throw new Error('private provider failure');}]){
  const h=fixture({respond:url=>url===securityURL?response():json(url.includes('/ohlcv/')?candles():poolData())});const [row]=await h.feed.snapshots();assert.equal(row.security,null);assert.equal(row.priceUsd,.001);
 }
});
test('unknown security fields are omitted and holder evidence remains conservatively incomplete',async()=>{
 for(const change of [s=>{s.holders.pop();},s=>{s.holders[0].percent='';},s=>{s.holders[0].percent='2';},s=>{s.holders[0].address=s.holders[1].address;},s=>{s.holder_count='';},s=>{s.holder_count='5';},s=>{s.holders[0].percent='0.99';}]){
  const raw=tokenSecurity();change(raw.result[TOKEN]);raw.result[TOKEN].is_honeypot=null;
  const h=fixture({respond:url=>json(url===securityURL?raw:url.includes('/ohlcv/')?candles():poolData())});const [row]=await h.feed.snapshots();assert.equal(row.security.top10HolderPct,null);assert.equal(row.security.flags.is_honeypot,undefined);
 }
 const raw=tokenSecurity(),s=raw.result[TOKEN];s.holder_count='2';s.holders=[{address:POOL,percent:'.7',tag:'LP'},{address:POOL2,percent:'.3',tag:'Burn Address'}];
 const h=fixture({respond:url=>json(url===securityURL?raw:url.includes('/ohlcv/')?candles():poolData())});assert.equal((await h.feed.snapshots())[0].security.top10HolderPct,100);
});
test('rolling request budget stops after eight requests and resets after one minute',async()=>{
 const h=fixture({respond:()=>new Response('provider detail must not escape',{status:503})});
 for(let i=0;i<9;i++)await assert.rejects(h.feed.snapshots(),/^Error: Base market data unavailable\.$/);assert.equal(h.calls.length,8);
 h.time(T+60000);await assert.rejects(h.feed.snapshots(),/Base market data unavailable/);assert.equal(h.calls.length,9);
});
test('429 cooldown honors Retry-After and performs no automatic retry',async()=>{
 const h=fixture({respond:()=>new Response('slow down',{status:429,headers:{'retry-after':'120'}})});
 await assert.rejects(h.feed.snapshots(),/Base market data unavailable/);assert.equal(h.calls.length,1);
 h.time(T+119999);await assert.rejects(h.feed.snapshots(),/Base market data unavailable/);assert.equal(h.calls.length,1);
 h.time(T+120000);await assert.rejects(h.feed.snapshots(),/Base market data unavailable/);assert.equal(h.calls.length,2);
});
test('429 minimum cooldown is one minute even for missing or shorter Retry-After',async()=>{
 for(const retry of [null,'0','1','invalid']){
  const h=fixture({respond:()=>new Response('limited',{status:429,headers:retry===null?{}:{'retry-after':retry}})});
  await assert.rejects(h.feed.snapshots(),/Base market data unavailable/);h.time(T+59999);await assert.rejects(h.feed.snapshots(),/Base market data unavailable/);assert.equal(h.calls.length,1);
  h.time(T+60000);await assert.rejects(h.feed.snapshots(),/Base market data unavailable/);assert.equal(h.calls.length,2);
 }
});
test('the twelve-second deadline aborts an unresponsive request without retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const h=fixture({respond:()=>new Promise(()=>{})});
 const waiting=h.feed.snapshots(),rejected=assert.rejects(waiting,/Base market data unavailable/);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.signal.aborted,false);
 t.mock.timers.tick(12000);await rejected;assert.equal(h.calls[0].init.signal.aborted,true);assert.equal(h.calls.length,1);
});
test('redirects, invalid JSON and oversized bodies fail without exposing provider text',async()=>{
 for(const response of [()=>new Response('secret',{status:302,headers:{location:'https://example.test'}}),()=>new Response('secret invalid json'),()=>new Response('x',{headers:{'Content-Length':'2000001'}}),()=>new Response('x'.repeat(2000001))]){
  const h=fixture({respond:response});await assert.rejects(h.feed.snapshots(),/^Error: Base market data unavailable\.$/);assert.equal(h.calls.length,1);
 }
});
test('a failure in a selected pool does not return a partial scan',async()=>{
 const h=fixture({feed:{pools:[POOL,POOL2]},respond:url=>url.includes(POOL2)?new Response('bad',{status:500}):json(url===securityURL?tokenSecurity():url.includes('/ohlcv/')?candles():poolData())});await assert.rejects(h.feed.snapshots(),/Base market data unavailable/);assert.equal(h.calls.length,4);
});
