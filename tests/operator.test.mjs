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
