import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemeOperator,PAPER_LIMITS} from '../operator.mjs';
import {memeFixture,FIXTURE_TIME as T} from '../examples/meme-fixture.mjs';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'ghost-meme-')),path=join(dir,'state.sqlite');let at=T,row=memeFixture();
 const feed={snapshots:async()=>[row]},o=new MemeOperator(path,{clock:()=>at,feed});
 t.after(()=>{o.close();rmSync(dir,{recursive:true,force:true});});
 return {o,path,feed,get row(){return row;},set(time,price){at=time;row={...row,observedAt:time,security:{...row.security,checkedAt:time},priceUsd:price??row.priceUsd};},time(time){at=time;}};
}
test('default is Base meme spot paper trading, paused, with no money execution',async t=>{
 const h=fixture(t),s=h.o.status();assert.equal(s.marketKind,'base-meme-spot');assert.equal(s.chainId,8453);assert.equal(s.strategy,'volume-breakout');assert.equal(s.cash,50);assert.equal(s.enabled,false);assert.equal(s.liveOrders,false);await assert.rejects(h.o.action('live'));
});
test('breakout creates a token buy; repeated same quote cannot fill; later quote persists a fill',async t=>{
 const h=fixture(t);await h.o.action('start');let r=await h.o.action('tick');assert.equal(r.orders[0]?.action,'BUY',JSON.stringify(r.diagnostics));assert.equal(r.orders[0].side,'SPOT');assert.equal(r.positions.length,0);
 await h.o.action('tick');assert.equal(h.o.status().positions.length,0);
 h.set(T+15000);r=await h.o.action('tick');assert.equal(r.positions.length,1);assert.ok(r.positions[0].cost<=5.02);assert.ok(r.cash<50);
 const reopened=new MemeOperator(h.path);assert.deepEqual(reopened.status(),r);reopened.close();
});
test('missing or bad token security and stale quotes never produce paper orders',async t=>{
 const h=fixture(t);await h.o.action('start');h.row.security=null;assert.equal((await h.o.action('tick')).orders.length,0);
 h.feed.snapshots=async()=>[{...memeFixture(),observedAt:T-90001}];assert.equal((await h.o.action('tick')).orders.length,0);
 h.feed.snapshots=async()=>{const r=memeFixture();r.security.flags.is_honeypot='1';return[r];};assert.equal((await h.o.action('tick')).orders.length,0);
});
test('take-profit requires a later fresh quote, accounts for costs and avoids reusing the signal',async t=>{
 const h=fixture(t);await h.o.action('start');await h.o.action('tick');h.set(T+15000);await h.o.action('tick');
 const p=h.o.status().positions[0];
 // Exit screening does not require an entry signal or rewrite historical candles.
 h.set(T+30000,p.takeProfit*1.01);
 let r=await h.o.action('tick');assert.equal(r.orders.find(o=>o.action==='SELL'&&o.status==='PENDING')?.exitReason,'TAKE_PROFIT');assert.equal(r.positions.length,1);
 h.set(T+45000);r=await h.o.action('tick');assert.equal(r.positions.length,0);assert.ok(r.realized>0);assert.ok(Math.abs(r.cash-50-r.realized)<1e-9);assert.ok(r.feesPaid>0);
});
test('unavailable sell evidence keeps the position unresolved instead of fabricating proceeds',async t=>{
 const h=fixture(t);await h.o.action('start');await h.o.action('tick');h.set(T+15000);await h.o.action('tick');const before=h.o.status();
 h.feed.snapshots=async()=>[];h.time(T+30000);const r=await h.o.action('tick');assert.equal(r.cash,before.cash);assert.equal(r.positions.length,1);assert.ok(r.diagnostics.some(d=>d.code==='POSITION_UNRESOLVED'));
});
test('pending buys expire and four-hour session cannot renew itself',async t=>{
 const h=fixture(t);await h.o.action('start');await assert.rejects(h.o.action('start'),/extended/);await h.o.action('tick');
 h.time(T+PAPER_LIMITS.orderExpiryMs);await h.o.action('tick');assert.equal(h.o.status().orders[0].status,'CANCELLED');
 h.time(T+PAPER_LIMITS.sessionMs);const r=await h.o.action('tick');assert.equal(r.enabled,false);assert.equal(r.positions.length,0);
});
test('pause cancels pending entry and concurrent workers cannot change leased ledger',async t=>{
 const h=fixture(t);await h.o.action('start');await h.o.action('tick');let release;h.feed.snapshots=()=>new Promise(r=>{release=r;});
 const pending=h.o.action('tick');await new Promise(r=>setImmediate(r));const other=new MemeOperator(h.path,{clock:()=>T});await assert.rejects(other.action('pause'),/Another worker/);other.close();release([h.row]);await pending;
 const paused=await h.o.action('pause');assert.equal(paused.enabled,false);assert.equal(paused.orders[0].status,'CANCELLED');
});
test('legacy BTC ledger cannot be silently used as a meme-token account',t=>{
 const dir=mkdtempSync(join(tmpdir(),'ghost-legacy-')),path=join(dir,'state.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const db=new DatabaseSync(path);db.exec('CREATE TABLE ghost_grok (id INTEGER)');db.close();assert.throws(()=>new MemeOperator(path),/Legacy BTC ledger/);
});
test('a newer but pre-order quote cannot model a fill',async t=>{
 const h=fixture(t);h.row.observedAt=T-60000;await h.o.action('start');await h.o.action('tick');assert.equal(h.o.status().orders[0]?.status,'PENDING');
 h.time(T+15000);h.row.observedAt=T-30000;await h.o.action('tick');assert.equal(h.o.status().positions.length,0);
 h.set(T+30000);await h.o.action('tick');assert.equal(h.o.status().positions.length,1);
});
test('a price gap is modeled at the later quote, exceeds planned stop loss and locks new entries',async t=>{
 const h=fixture(t);await h.o.action('start');await h.o.action('tick');h.set(T+15000);await h.o.action('tick');
 const p=h.o.status().positions[0];h.set(T+30000,p.entry*.2);let r=await h.o.action('tick');assert.equal(r.riskLock,'DAILY_LOSS_LIMIT');assert.equal(r.enabled,false);assert.equal(r.positions.length,1);
 h.set(T+45000,p.entry*.15);r=await h.o.action('tick');assert.equal(r.positions.length,0);assert.ok(r.realized<-.25);assert.ok(Math.abs(r.cash-50-r.realized)<1e-9);assert.ok(!r.orders.some(o=>o.action==='BUY'&&o.status==='PENDING'));await assert.rejects(h.o.action('start'),/Risk lock/);
});
test('extreme finite market prices cannot corrupt a persisted paper ledger',async t=>{
 const h=fixture(t);await h.o.action('start');await h.o.action('tick');h.set(T+15000);await h.o.action('tick');const before=h.o.status();
 h.set(T+30000,1e308);const r=await h.o.action('tick');assert.equal(r.cash,before.cash);assert.equal(r.positions.length,1);assert.equal(h.o.read().peakEquity,50);assert.ok(r.diagnostics.some(d=>d.code==='POSITION_UNRESOLVED'));
 const reopen=new MemeOperator(h.path);assert.equal(reopen.status().cash,before.cash);reopen.close();
});
test('status and pause remain available when market configuration is invalid',async t=>{
 const h=fixture(t);await h.o.action('start');const previous=process.env.GHOST_BASE_POOLS;
 try{
  process.env.GHOST_BASE_POOLS='invalid';const other=new MemeOperator(h.path,{clock:()=>T});
  try{assert.equal(other.status().enabled,true);assert.equal((await other.action('pause')).enabled,false);}finally{other.close();}
 }finally{if(previous===undefined)delete process.env.GHOST_BASE_POOLS;else process.env.GHOST_BASE_POOLS=previous;}
});
test('resuming an unexpired session preserves its deadline and cumulative spend',async t=>{
 const h=fixture(t);await h.o.action('start');await h.o.action('tick');h.set(T+15000);await h.o.action('tick');
 const p=h.o.status().positions[0];h.set(T+30000,p.takeProfit*1.01);await h.o.action('tick');h.set(T+45000);await h.o.action('tick');
 const before=h.o.read();assert.ok(before.spent>0);await h.o.action('pause');h.time(T+60000);await h.o.action('start');
 const after=h.o.read();assert.equal(after.sessionUntil,before.sessionUntil);assert.equal(after.spent,before.spent);assert.equal(after.enabled,true);
});
test('overnight losses trigger the daily lock before a subsequent entry',async t=>{
 const h=fixture(t),start=Date.parse('2026-01-01T23:59:00Z');let row=memeFixture(start);h.time(start);h.feed.snapshots=async()=>[row];
 await h.o.action('start');await h.o.action('tick');
 const advance=(at,price)=>{h.time(at);row={...row,priceUsd:price??row.priceUsd,observedAt:at,security:{...row.security,checkedAt:at}};};
 advance(start+15000);await h.o.action('tick');const p=h.o.status().positions[0];
 advance(start+75000,p.entry*.2);let result=await h.o.action('tick');assert.equal(result.riskLock,'DAILY_LOSS_LIMIT');assert.equal(result.enabled,false);
 advance(start+90000);result=await h.o.action('tick');assert.equal(result.positions.length,0);assert.ok(result.realized<-1.5);
 row=memeFixture(start+105000);h.time(start+105000);result=await h.o.action('tick');assert.ok(!result.orders.some(o=>o.status==='PENDING'&&o.action==='BUY'));
});
test('malformed recovery state cannot bypass session or risk limits',async t=>{
 const h=fixture(t);await h.o.action('start');const original=h.o.read(),db=new DatabaseSync(h.path);
 try{
  for(const patch of [{sessionUntil:'never'},{enabled:'true'},{dayStartEquity:null},{riskLock:'ignored'},{lastTick:-1},{positions:[{}]},{orders:[{}]},{spent:-1},{lastEquity:null},{cash:500},{realized:10}]){
   db.prepare('UPDATE ghost_meme SET payload=? WHERE id=1').run(JSON.stringify({...original,...patch}));
   await assert.rejects(h.o.action('tick'),/Invalid meme-coin simulation ledger/);
  }
 }finally{db.prepare('UPDATE ghost_meme SET payload=? WHERE id=1').run(JSON.stringify(original));db.close();}
});
test('entries whose target loses money after modeled costs are rejected before and at fill',async t=>{
 const h=fixture(t);await h.o.action('start');h.row.security.flags.buy_tax='0.05';h.row.security.flags.sell_tax='0.05';
 let r=await h.o.action('tick');assert.equal(r.orders.length,0);assert.ok(r.diagnostics.some(d=>d.code==='NET_TARGET_LOSS'));
 h.row.security.flags.buy_tax='0';h.row.security.flags.sell_tax='0';await h.o.action('tick');assert.equal(h.o.status().orders[0]?.status,'PENDING');
 h.set(T+15000);h.row.security.flags.buy_tax='0.05';h.row.security.flags.sell_tax='0.05';r=await h.o.action('tick');
 assert.equal(r.positions.length,0);assert.equal(r.orders[0].status,'CANCELLED');assert.equal(r.cash,50);
});
test('restart validates position and order contents and preserves an unresolved mark',async t=>{
 const h=fixture(t);await h.o.action('start');await h.o.action('tick');h.set(T+15000);await h.o.action('tick');
 const original=h.o.read(),db=new DatabaseSync(h.path);
 try{
  for(const change of [s=>s.positions[0].quantity=-1,s=>s.positions[0].stop='invalid',s=>s.positions[0].marketKey='different',s=>s.orders[0].status='CONFIRMED',s=>s.orders[0].filledAt=null]){
   const s=structuredClone(original);change(s);db.prepare('UPDATE ghost_meme SET payload=? WHERE id=1').run(JSON.stringify(s));
   assert.throws(()=>new MemeOperator(h.path),/Invalid meme-coin simulation ledger/);
  }
 }finally{db.prepare('UPDATE ghost_meme SET payload=? WHERE id=1').run(JSON.stringify(original));db.close();}
 h.feed.snapshots=async()=>[];h.time(T+30000);await h.o.action('tick');assert.equal(h.o.read().lastEquity,original.lastEquity);
});
test('older v3 ledgers retain a conservative mark and a regressed clock cannot create entries',async t=>{
 const h=fixture(t);await h.o.action('start');await h.o.action('tick');const original=h.o.read(),db=new DatabaseSync(h.path);
 const old={...original};delete old.lastEquity;db.prepare('UPDATE ghost_meme SET payload=? WHERE id=1').run(JSON.stringify(old));db.close();
 assert.equal(h.o.read().lastEquity,old.peakEquity);h.time(T-1);await assert.rejects(h.o.action('tick'),/regressed clock/);
 assert.equal((await h.o.action('pause')).enabled,false);
});
