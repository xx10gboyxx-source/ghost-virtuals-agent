import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_TOKENS,createPoolDiscovery} from '../server/pool-discovery.mjs';

const T=1791990000000,TOKEN='0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4';
const TOKEN2='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',QUOTE='0x4200000000000000000000000000000000000006';
const POOL='0x1111111111111111111111111111111111111111',POOL2='0x2222222222222222222222222222222222222222';
const endpoint=token=>`https://api.geckoterminal.com/api/v2/networks/base/tokens/${token}/pools?include=base_token,quote_token&page=1`;
const row=(pool=POOL,liquidity='100000',token=TOKEN)=>({id:`base_${pool}`,type:'pool',attributes:{address:pool,reserve_in_usd:liquidity},relationships:{base_token:{data:{id:`base_${token}`,type:'token'}},quote_token:{data:{id:`base_${QUOTE}`,type:'token'}}}});
const payload=(rows=[row()])=>({data:rows,included:[]});
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function fixture({tokens,respond}={}){let at=T;const calls=[];const discovery=createPoolDiscovery({...(tokens===undefined?{}:{tokens}),now:()=>at,fetcher:async(url,init)=>{calls.push({url,init});return respond?respond(url,init,calls.length):json(payload());}});return {discovery,calls,time:value=>{at=value;}};}

test('default token is frozen TOSHI and unsigned public request selects the highest supported liquidity',async()=>{
 assert.deepEqual(DEFAULT_TOKENS,[TOKEN]);assert.equal(Object.isFrozen(DEFAULT_TOKENS),true);
 const h=fixture({respond:()=>json(payload([row(POOL,'1'),row(POOL2,'200000'),row('0x'+'9'.repeat(64),'900000')]))});const result=await h.discovery.discover();
 assert.deepEqual(result,{pools:[POOL2],tokens:[TOKEN],source:'token-pools',checkedAt:T,retryAt:T+900000,status:'OK',code:'POOLS_DISCOVERED'});
 assert.equal(h.calls[0].url,endpoint(TOKEN));const init=h.calls[0].init;assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.headers.Authorization,undefined);assert.equal(init.headers['x-cg-pro-api-key'],undefined);assert.ok(init.signal instanceof AbortSignal);
 assert.equal(result.riskApproved,undefined);
});
test('token selection allows at most two unique nonzero 20-byte contracts',async()=>{
 for(const tokens of [[TOKEN,TOKEN.toUpperCase().replace('0X','0x')],[TOKEN,TOKEN2,QUOTE],['0x'+'0'.repeat(40)],['https://example.test'],[TOKEN+'?auth=anything'],'all'])assert.throws(()=>createPoolDiscovery({tokens}),/token/i);
 const h=fixture({tokens:[]});const result=await h.discovery.discover();assert.equal(result.status,'WAIT');assert.equal(result.code,'NO_TOKENS_CONFIGURED');assert.deepEqual(result.pools,[]);assert.equal(h.calls.length,0);
});
test('input/result mutations cannot change configured tokens or cached discovery',async()=>{
 const tokens=[TOKEN],h=fixture({tokens});tokens[0]=TOKEN2;const first=await h.discovery.discover();first.tokens[0]=QUOTE;first.pools[0]=POOL2;
 const next=await h.discovery.discover();assert.deepEqual(next.tokens,[TOKEN]);assert.deepEqual(next.pools,[POOL]);assert.equal(h.calls.length,1);
});
test('identity, liquidity, quote-side tokens and unsupported pool shapes cannot become candidates',async()=>{
 for(const mutate of [r=>{r.id=`eth_${POOL}`;},r=>{r.attributes.address=POOL2;},r=>{r.type='token';},r=>{r.relationships.base_token.data.id=`base_${QUOTE}`;r.relationships.quote_token.data.id=`base_${TOKEN}`;},r=>{r.relationships.base_token.data.type='pool';},r=>{r.relationships.quote_token.data.id=`base_${TOKEN}`;},r=>{r.relationships.quote_token.data.id=`base_${'0x'+'0'.repeat(40)}`;},r=>{r.relationships.quote_token.data.id=`eth_${QUOTE}`;},r=>{r.attributes.address='0x'+'9'.repeat(64);r.id=`base_${r.attributes.address}`;}]){
  const candidate=row();mutate(candidate);const h=fixture({respond:()=>json(payload([candidate]))});const result=await h.discovery.discover();assert.equal(result.status,'WAIT');assert.deepEqual(result.pools,[]);
 }
 for(const value of [undefined,null,'',' ','NaN','Infinity',true,'0x10',-1,0]){
  const candidate=row();candidate.attributes.reserve_in_usd=value;const result=await fixture({respond:()=>json(payload([candidate]))}).discovery.discover();assert.equal(result.status,'WAIT');assert.deepEqual(result.pools,[]);
 }
});
test('malformed or ambiguous listings return WAIT instead of a candidate',async()=>{
 for(const response of [{},payload(null),payload(Array(21).fill(row())),payload([row(),row(POOL,'200000')])]){
  const h=fixture({respond:()=>json(response)}),result=await h.discovery.discover();assert.equal(result.status,'WAIT');assert.deepEqual(result.pools,[]);assert.equal(result.retryAt,T+60000);
 }
});
test('cache lasts fifteen minutes while retaining its original checkedAt',async()=>{
 const h=fixture();await h.discovery.discover();h.time(T+899999);let result=await h.discovery.discover();assert.equal(h.calls.length,1);assert.equal(result.checkedAt,T);
 h.time(T+900000);result=await h.discovery.discover();assert.equal(h.calls.length,2);assert.equal(result.checkedAt,T+900000);
});
test('a failed refresh returns WAIT with no stale candidate and waits sixty seconds',async()=>{
 const h=fixture({respond:(_u,_i,n)=>n===1?json(payload()):new Response('provider secret',{status:500})});await h.discovery.discover();h.time(T+900000);
 let result=await h.discovery.discover();assert.equal(result.status,'WAIT');assert.deepEqual(result.pools,[]);assert.equal(result.code,'DISCOVERY_UNAVAILABLE');assert.equal(result.retryAt,T+960000);
 h.time(T+959999);result=await h.discovery.discover();assert.equal(h.calls.length,2);assert.deepEqual(result.pools,[]);
 h.time(T+960000);await h.discovery.discover();assert.equal(h.calls.length,3);
});
test('concurrent discoveries coalesce and two tokens are fetched sequentially',async()=>{
 let active=0,peak=0;const h=fixture({tokens:[TOKEN,TOKEN2],respond:async url=>{active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;return json(payload([row(url===endpoint(TOKEN)?POOL:POOL2,'1000',url===endpoint(TOKEN)?TOKEN:TOKEN2)]));}});
 const [a,b]=await Promise.all([h.discovery.discover(),h.discovery.discover()]);assert.deepEqual(a.pools,[POOL,POOL2]);assert.deepEqual(a,b);assert.notEqual(a,b);assert.equal(h.calls.length,2);assert.equal(peak,1);
});
test('failure for one selected token cannot return a partial discovery',async()=>{
 const h=fixture({tokens:[TOKEN,TOKEN2],respond:url=>url===endpoint(TOKEN)?json(payload()):new Response('bad',{status:503})});const result=await h.discovery.discover();assert.equal(result.status,'WAIT');assert.deepEqual(result.pools,[]);assert.equal(h.calls.length,2);
});
test('429 honors Retry-After seconds/date, applies a sixty-second floor and never retries automatically',async()=>{
 for(const [retry,delay] of [['120',120000],[new Date(T+180000).toUTCString(),180000],['0',60000],['invalid',60000],[null,60000]]){
  const h=fixture({respond:()=>new Response('limited',{status:429,headers:retry===null?{}:{'retry-after':retry}})});
  let result=await h.discovery.discover();assert.equal(result.code,'DISCOVERY_RATE_LIMITED');assert.equal(result.retryAt,T+delay);assert.equal(h.calls.length,1);
  h.time(T+delay-1);await h.discovery.discover();assert.equal(h.calls.length,1);h.time(T+delay);await h.discovery.discover();assert.equal(h.calls.length,2);
 }
});
test('redirects, oversized bodies and invalid JSON return generic WAIT without provider text',async()=>{
 for(const respond of [()=>new Response('private-detail',{status:302,headers:{location:'https://example.test'}}),()=>new Response('private-detail'),()=>new Response('x',{headers:{'Content-Length':'2000001'}}),()=>new Response('x'.repeat(2000001))]){
  const h=fixture({respond}),result=await h.discovery.discover();assert.equal(result.status,'WAIT');assert.deepEqual(result.pools,[]);assert.equal(JSON.stringify(result).includes('private-detail'),false);assert.equal(h.calls.length,1);
 }
});
test('twelve-second deadline aborts a hung fetch without an automatic retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=fixture({respond:()=>new Promise(()=>{})}),waiting=h.discovery.discover();assert.equal(h.calls.length,1);
 t.mock.timers.tick(12000);const result=await waiting;assert.equal(result.status,'WAIT');assert.equal(h.calls[0].init.signal.aborted,true);assert.equal(h.calls.length,1);
});
test('the deadline also bounds a stalled response body',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=fixture({respond:()=>new Response(new ReadableStream({start(){}}))});
 const waiting=h.discovery.discover();await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(12000);
 const result=await waiting;assert.equal(result.status,'WAIT');assert.deepEqual(result.pools,[]);assert.equal(h.calls[0].init.signal.aborted,true);
});
test('invalid and regressed clocks clear candidates and make no network request',async()=>{
 const h=fixture();await h.discovery.discover();h.time(T-1);let result=await h.discovery.discover();assert.equal(result.code,'CLOCK_REGRESSED');assert.deepEqual(result.pools,[]);assert.equal(h.calls.length,1);
 h.time(T+59999);await h.discovery.discover();assert.equal(h.calls.length,1);h.time(T+60000);result=await h.discovery.discover();assert.equal(result.status,'OK');assert.equal(h.calls.length,2);
 h.time(NaN);result=await h.discovery.discover();assert.equal(result.code,'CLOCK_INVALID');assert.deepEqual(result.pools,[]);assert.equal(h.calls.length,2);
 const initial=fixture();initial.time(undefined);result=await initial.discovery.discover();assert.equal(result.status,'WAIT');assert.equal(result.checkedAt,null);assert.equal(result.retryAt,null);assert.equal(initial.calls.length,0);
});
test('clock faults during a coalesced request prevent an older request from restoring candidates',async()=>{
 let release;const h=fixture({respond:()=>new Promise(r=>{release=r;})}),waiting=h.discovery.discover();h.time(T-1);assert.equal((await h.discovery.discover()).code,'CLOCK_REGRESSED');h.time(T);release(json(payload()));const result=await waiting;assert.equal(result.status,'WAIT');assert.deepEqual(result.pools,[]);
});
