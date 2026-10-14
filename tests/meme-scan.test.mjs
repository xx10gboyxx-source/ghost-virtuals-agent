import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {scanMemePool} from '../agent/meme-scan.mjs';
import {memeFixture,FIXTURE_TIME} from '../examples/meme-fixture.mjs';

const poolAddress=memeFixture().poolAddress;
const request={poolAddress};
const options=snapshot=>({now:()=>FIXTURE_TIME,feedFactory:()=>({snapshots:async()=>[snapshot]})});

test('request validation prevents network reads and rejects extra capabilities',async()=>{
 let calls=0;
 const config={now:()=>FIXTURE_TIME,feedFactory:()=>{calls++;throw new Error('must not fetch');}};
 for(const input of [null,[],{}, {poolAddress:'https://example.com'}, {poolAddress:`0x${'0'.repeat(40)}`}, {...request,strategy:'btc-15m'}, {...request,execute:true}, {...request,capitalUsd:50}]){
  const {report}=await scanMemePool(input,config);
  assert.equal(report.status,'WAIT');assert.equal(report.code,'INVALID_REQUEST');assert.equal(report.plan,null);assert.equal(report.liveOrders,false);
 }
 assert.equal(calls,0);
});

test('one requested pool produces an evidence-timed research report with a 2R plan',async()=>{
 const snapshot=memeFixture();let selected;
 const {report}=await scanMemePool(request,{now:()=>FIXTURE_TIME,feedFactory:config=>{selected=config.pools;return {snapshots:async()=>[snapshot]};}});
 assert.deepEqual(selected,[poolAddress]);assert.equal(report.status,'PASS');assert.equal(report.mode,'research');assert.equal(report.liveOrders,false);
 assert.equal(report.chainId,8453);assert.equal(report.timeframe,'5m');assert.equal(report.tokenAddress,snapshot.tokenAddress);
 assert.equal(report.evidence.quoteObservedAt,FIXTURE_TIME);assert.equal(report.evidence.latestClosedCandleAt,FIXTURE_TIME-300000);
 assert.ok(Math.abs((report.plan.takeProfit-report.plan.entry)/(report.plan.entry-report.plan.stop)-2)<1e-10);
});

test('optional strategy selects the actual pullback evaluation',async()=>{
 const {report}=await scanMemePool({...request,strategy:'trend-pullback'},options(memeFixture()));
 assert.equal(report.strategy,'trend-pullback');assert.equal(report.status,'WAIT');assert.equal(report.code,'RSI_LIMIT');assert.equal(report.plan,null);
});

test('provider failures produce a non-executable report without exception text',async()=>{
 const result=await scanMemePool(request,{now:()=>FIXTURE_TIME,feedFactory:()=>({snapshots:async()=>{throw new Error('PRIVATE_ERROR_TEXT');}})});
 assert.equal(result.report.status,'WAIT');assert.equal(result.report.code,'FEED_UNAVAILABLE');assert.equal(result.report.plan,null);
 assert.ok(!JSON.stringify(result).includes('PRIVATE_ERROR_TEXT'));
});

test('incomplete and stale evidence cannot become a passing job',async()=>{
 for(const mutate of [s=>s.security=null,s=>s.observedAt=FIXTURE_TIME-90001,s=>s.candles.pop()]){
  const snapshot=memeFixture();mutate(snapshot);
  const {report}=await scanMemePool(request,options(snapshot));assert.equal(report.status,'WAIT');assert.equal(report.plan,null);
 }
});

test('mismatched pool and known unsafe token stay blocked',async()=>{
 const mismatch=memeFixture();mismatch.poolAddress=`0x${'3'.repeat(40)}`;
 assert.equal((await scanMemePool(request,options(mismatch))).report.code,'POOL_MISMATCH');
 const unsafe=memeFixture();unsafe.security.flags.is_honeypot='1';
 const {report}=await scanMemePool(request,options(unsafe));assert.equal(report.status,'BLOCKED');assert.equal(report.code,'CONTRACT_RISK');assert.equal(report.plan,null);
});

test('CLI accepts bounded JSON and fails safely for invalid or oversized input',()=>{
 const script=new URL('../agent/meme-scan.mjs',import.meta.url);
 for(const input of ['{bad json',JSON.stringify({...request,execute:true}),'x'.repeat(4097)]){
  const run=spawnSync(process.execPath,[script.pathname],{input,encoding:'utf8',timeout:5000});
  assert.equal(run.status,1);const result=JSON.parse(run.stdout);assert.equal(result.report.status,'WAIT');assert.equal(result.report.liveOrders,false);
 }
});
