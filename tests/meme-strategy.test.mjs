import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMeme,screenMeme,STRATEGIES} from '../server/meme-strategy.mjs';

const NOW=1800000000000;
const TOKEN=`0x${'1'.repeat(40)}`;
const POOL=`0x${'2'.repeat(40)}`;
const riskFlags=['is_honeypot','cannot_buy','cannot_sell_all','is_mintable','is_proxy','transfer_pausable','slippage_modifiable','owner_change_balance','hidden_owner','is_blacklisted','personal_slippage_modifiable','anti_whale_modifiable','trading_cooldown','can_take_back_ownership','external_call','selfdestruct','is_whitelisted','is_anti_whale'];
function fixture(strategy='volume-breakout'){
  const current=Math.floor(NOW/300000)*300;
  const closes=Array.from({length:60},(_,i)=>1+i*(strategy==='volume-breakout'?.001:.002));
  if(strategy==='volume-breakout')closes[59]=1.07;
  else {closes[58]=1.08;closes[59]=1.095;}
  const candles=closes.map((close,i)=>{
    const open=i?closes[i-1]:close-.001;
    return {time:current-(60-i)*300,open,high:Math.max(open,close)+.002,low:Math.min(open,close)-.002,close,volume:i===59?2500:1000};
  });
  return {chainId:8453,tokenAddress:TOKEN,poolAddress:POOL,observedAt:NOW,priceUsd:closes.at(-1),liquidityUsd:200000,volume24hUsd:100000,poolCreatedAt:NOW-72*3600000,candles,
    security:{checkedAt:NOW,chainId:8453,tokenAddress:TOKEN,source:'goplus',flags:{is_open_source:'1',...Object.fromEntries(riskFlags.map(k=>[k,'0'])),buy_tax:'0.01',sell_tax:'0.02'},top10HolderPct:20}};
}
const evaluate=(snapshot,options={})=>evaluateMeme(snapshot,{now:NOW,...options});

test('both declared strategies produce bounded paper plans from eligible closed candles',()=>{
  assert.deepEqual(STRATEGIES,['volume-breakout','trend-pullback']);
  for(const strategy of STRATEGIES){
    const snapshot=fixture(strategy),before=structuredClone(snapshot);
    const r=evaluate(snapshot,{strategy});
    assert.equal(r.status,'PASS',`${strategy}: ${r.code} ${r.reason}`);
    assert.equal(r.plan.tokenAddress,TOKEN);assert.equal(r.plan.poolAddress,POOL);
    assert.equal(r.plan.entry,snapshot.candles.at(-1).close);
    assert.equal(r.plan.signalAt,NOW);assert.equal(r.checkedAt,NOW);
    const risk=r.plan.entry-r.plan.stop;
    assert.ok(risk>=r.plan.entry*.03-1e-12);assert.ok(risk<=r.plan.entry*.1+1e-12);
    assert.ok(Math.abs(r.plan.takeProfit-r.plan.entry-2*risk)<1e-12);
    assert.deepEqual(snapshot,before,'evaluation is read-only');
  }
});

test('common screen verifies execution evidence without requiring an entry signal or candles',()=>{
  const snapshot=fixture();delete snapshot.candles;
  const r=screenMeme(snapshot,{now:NOW});
  assert.equal(r.status,'PASS');assert.equal(r.plan,undefined);
  assert.equal(evaluate(snapshot).status,'WAIT');
});

test('missing or unknown security flags fail closed; every explicit unsafe flag blocks',()=>{
  for(const key of ['is_open_source',...riskFlags]){
    const missing=fixture();delete missing.security.flags[key];
    assert.equal(evaluate(missing).status,'WAIT',key);
    const unknown=fixture();unknown.security.flags[key]='unknown';
    assert.equal(evaluate(unknown).status,'WAIT',key);
    const risky=fixture();risky.security.flags[key]=key==='is_open_source'?'0':'1';
    assert.equal(evaluate(risky).status,'BLOCKED',key);
  }
  const multiple=fixture();delete multiple.security.flags.is_open_source;multiple.security.flags.is_honeypot='1';
  assert.equal(evaluate(multiple).status,'BLOCKED','known risk wins over incomplete flags');
});

test('tax, holder concentration and security source must be explicit and bounded',()=>{
  for(const key of ['buy_tax','sell_tax']){
    for(const value of [undefined,null,'','NaN','Infinity',NaN,Infinity,'-0.01','1.1',true]){
      const snapshot=fixture();snapshot.security.flags[key]=value;
      assert.equal(evaluate(snapshot).status,'WAIT',`${key} ${String(value)}`);
    }
    const high=fixture();high.security.flags[key]='0.0501';assert.equal(evaluate(high).status,'BLOCKED');
    const edge=fixture();edge.security.flags[key]='0.05';assert.equal(evaluate(edge).status,'PASS');
  }
  for(const value of [undefined,null,NaN,101,-1,'20']){
    const snapshot=fixture();snapshot.security.top10HolderPct=value;assert.equal(evaluate(snapshot).status,'WAIT');
  }
  const concentrated=fixture();concentrated.security.top10HolderPct=30.01;assert.equal(evaluate(concentrated).status,'BLOCKED');
  const boundary=fixture();boundary.security.top10HolderPct=30;assert.equal(evaluate(boundary).status,'PASS');
  const source=fixture();source.security.source='unverified';assert.equal(evaluate(source).status,'WAIT');
});

test('Base and token security identity must match, with valid distinct pool identity',()=>{
  for(const change of [s=>s.chainId=1,s=>s.security.chainId=1,s=>s.security.tokenAddress=POOL]){
    const snapshot=fixture();change(snapshot);assert.equal(evaluate(snapshot).status,'BLOCKED');
  }
  for(const change of [s=>s.tokenAddress='missing',s=>s.poolAddress=TOKEN,s=>s.poolAddress=`0x${'0'.repeat(40)}`,s=>delete s.security.chainId]){
    const snapshot=fixture();change(snapshot);assert.equal(evaluate(snapshot).status,'WAIT');
  }
});

test('freshness, pool age, liquidity and volume gates include their exact boundaries',()=>{
  for(const change of [s=>s.observedAt=NOW-90001,s=>s.observedAt=NOW+1,s=>s.security.checkedAt=NOW-300001,s=>s.security.checkedAt=NOW+1,s=>s.poolCreatedAt=NOW+1,s=>s.poolCreatedAt=NOW-48*3600000+1,s=>s.liquidityUsd=99999,s=>s.volume24hUsd=49999,s=>s.priceUsd=NaN]){
    const snapshot=fixture();change(snapshot);const r=evaluate(snapshot);assert.equal(r.status,'WAIT');assert.equal(r.plan,null);
  }
  const edge=fixture();Object.assign(edge,{observedAt:NOW-90000,poolCreatedAt:NOW-48*3600000,liquidityUsd:100000,volume24hUsd:50000});edge.security.checkedAt=NOW-300000;
  assert.equal(evaluate(edge).status,'PASS');
});

test('current open candle cannot influence a signal; malformed or future candles cannot pass',()=>{
  const snapshot=fixture();const original=evaluate(snapshot);
  snapshot.candles.push({time:NOW/1000,open:1.07,high:100,low:.01,close:99,volume:1e10});
  assert.deepEqual(evaluate(snapshot).plan,original.plan);
  for(const change of [s=>s.candles.at(-1).time+=300,s=>s.candles.at(-1).high=1,s=>s.candles.at(-1).volume=NaN]){
    const copy=structuredClone(snapshot);change(copy);assert.equal(evaluate(copy).status,'WAIT');
  }
});

test('requires 60 aligned contiguous ordered closed five-minute candles and current closed bar',()=>{
  for(const change of [s=>s.candles.pop(),s=>s.candles.shift(),s=>s.candles[20].time+=1,s=>s.candles[20].time=s.candles[19].time,s=>s.candles.splice(20,1),s=>s.candles.reverse(),s=>s.candles[0].low=-1,s=>s.candles[0].open='1']){
    const snapshot=fixture();change(snapshot);assert.equal(evaluate(snapshot).status,'WAIT');
  }
});

test('breakout rejects weak volume, absent break, excessive chase and mismatched quote',()=>{
  const lowVolume=fixture();lowVolume.candles.at(-1).volume=1999;assert.equal(evaluate(lowVolume).status,'WAIT');
  const absent=fixture();Object.assign(absent.candles.at(-1),{close:1.059,high:1.061});absent.priceUsd=1.059;assert.equal(evaluate(absent).status,'WAIT');
  const chase=fixture();Object.assign(chase.candles.at(-1),{close:1.11,high:1.112});chase.priceUsd=1.11;assert.equal(evaluate(chase).code,'CHASE_LIMIT');
  const mismatch=fixture();mismatch.priceUsd*=1.031;assert.equal(evaluate(mismatch).code,'QUOTE_CANDLE_MISMATCH');
  for(const factor of [.97,1.03]){
    const edge=fixture();edge.priceUsd*=factor;assert.equal(evaluate(edge).status,'PASS','inclusive 3% quote boundary');
  }
  const chaseEdge=fixture();const level=Math.max(...chaseEdge.candles.slice(-21,-1).map(c=>c.high));
  chaseEdge.candles.at(-1).close=level*1.03;chaseEdge.candles.at(-1).high=level*1.03+.002;chaseEdge.priceUsd=level*1.03;
  assert.equal(evaluate(chaseEdge).status,'PASS','inclusive 3% chase boundary');
});

test('trend pullback requires recovery, adequate volume and bounded volatility',()=>{
  const weak=fixture('trend-pullback');weak.candles.at(-1).volume=1199;assert.equal(evaluate(weak,{strategy:'trend-pullback'}).status,'WAIT');
  const red=fixture('trend-pullback');Object.assign(red.candles.at(-1),{open:1.096,high:1.098});assert.equal(evaluate(red,{strategy:'trend-pullback'}).status,'WAIT');
  const volatile=fixture();for(const candle of volatile.candles)candle.low-=.2;
  const r=evaluate(volatile);assert.equal(r.code,'VOLATILITY_LIMIT');assert.equal(r.status,'WAIT');assert.equal(r.plan,null);
});

test('invalid input and clocks return a non-executable result',()=>{
  for(const value of [null,undefined,[],{},'x'])assert.equal(evaluate(value).status,'WAIT');
  for(const now of [NaN,Infinity,-1,'1800000000000'])assert.equal(evaluateMeme(fixture(),{now}).status,'WAIT');
  assert.equal(evaluate(fixture(),{strategy:'btc-15m'}).status,'WAIT');
});
test('known per-wallet taxes and other unsupported trading restrictions cannot pass',()=>{
 for(const key of ['personal_slippage_modifiable','anti_whale_modifiable','trading_cooldown','can_take_back_ownership','external_call','selfdestruct','is_whitelisted','is_anti_whale']){
  const snapshot=fixture();snapshot.security.flags[key]='1';assert.equal(evaluate(snapshot).status,'BLOCKED',key);
 }
});
