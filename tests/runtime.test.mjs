import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {GhostRuntime,CYCLE_MS,validateRuntimeConfig} from '../agent/runtime.mjs';
import {configFromEnv} from '../agent/run.mjs';
import {memeFixture,FIXTURE_TIME as T} from '../examples/meme-fixture.mjs';
const POOL='0x2222222222222222222222222222222222222222',OTHER='0x3333333333333333333333333333333333333333';
const config={selection:'pools',addresses:[POOL],strategy:'volume-breakout'};
function harness(t,options={}){
 const dir=mkdtempSync(join(tmpdir(),'ghost-runtime-')),path=join(dir,'agent.sqlite');let at=T,row=memeFixture(T),requests=0;
 const feedFactory=()=>({snapshots:async()=>{requests++;return [structuredClone(row)];}});
 const runtime=new GhostRuntime(path,{config,clock:()=>at,feedFactory,...options});
 t.after(()=>{try{runtime.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 return {runtime,path,dir,feedFactory,clock:()=>at,get requests(){return requests;},set(next,price){at=next;row={...row,observedAt:at,priceUsd:price??row.priceUsd,security:{...row.security,checkedAt:at}};},row:()=>row};
}
test('new runtime operates with simulated capital and no wallet, AI or discovery credentials',async t=>{
 const h=harness(t,{discoveryFactory:()=>({discover(){throw new Error('Explicit pools must skip discovery');}})});
 const r=await h.runtime.cycle();assert.equal(r.health,'RUNNING');assert.equal(r.walletRequired,false);assert.equal(r.liveOrders,false);
 assert.equal(r.simulation.enabled,true);assert.equal(r.simulation.cash,50);assert.equal(r.simulation.orders[0].status,'PENDING');
 assert.equal(r.reports.length,2);assert.deepEqual(new Set(r.reports.map(x=>x.strategy)),new Set(['volume-breakout','trend-pullback']));
 assert.equal(h.requests,1);assert.equal(h.runtime.reports().length,1);
});
test('real operator lifecycle fills and closes a simulated position using later observations',async t=>{
 const h=harness(t);await h.runtime.cycle();h.set(T+CYCLE_MS);await h.runtime.cycle();const p=h.runtime.status().simulation.positions[0];assert.ok(p);
 h.set(T+2*CYCLE_MS,p.takeProfit*1.001);await h.runtime.cycle();assert.ok(h.runtime.status().simulation.orders.some(o=>o.action==='SELL'&&o.status==='PENDING'));
 h.set(T+3*CYCLE_MS);const r=await h.runtime.cycle();assert.equal(r.simulation.positions.length,0);assert.ok(r.simulation.orders.some(o=>o.action==='SELL'&&o.status==='FILLED'));assert.ok(r.simulation.realized>0);
 assert.equal(h.runtime.reports().length,4);
});
test('restart retains cash, positions, reports, original deadline and scan cadence',async t=>{
 const h=harness(t);await h.runtime.cycle();h.set(T+CYCLE_MS);await h.runtime.cycle();const before=h.runtime.status();h.runtime.close();
 const next=new GhostRuntime(h.path,{clock:h.clock,feedFactory:h.feedFactory});t.after(()=>next.close());
 assert.equal(next.status().simulation.cash,before.simulation.cash);assert.equal(next.status().simulation.sessionUntil,before.simulation.sessionUntil);
 assert.deepEqual(next.status().simulation.positions,before.simulation.positions);assert.equal(next.reports().length,2);
 assert.equal((await next.cycle()).code,'SCAN_COOLDOWN');assert.equal(h.requests,2);
});
test('pause survives restart while research continues',async t=>{
 const h=harness(t);await h.runtime.cycle();await h.runtime.control('pause');const deadline=h.runtime.status().simulation.sessionUntil;h.runtime.close();h.set(T+CYCLE_MS);
 const next=new GhostRuntime(h.path,{clock:h.clock,feedFactory:h.feedFactory});t.after(()=>next.close());
 const r=await next.cycle();assert.equal(r.health,'RUNNING');assert.equal(r.reports.length,2);assert.equal(r.simulation.enabled,false);assert.equal(r.simulation.sessionUntil,deadline);
 assert.equal(r.simulation.orders[0].status,'CANCELLED');
});
test('expired simulation stops entries while the research process continues without a new bankroll',async t=>{
 const h=harness(t);await h.runtime.cycle();const until=h.runtime.status().simulation.sessionUntil;
 h.set(until+1);const r=await h.runtime.cycle();assert.equal(r.health,'RUNNING');assert.equal(r.simulation.enabled,false);assert.equal(r.simulation.sessionUntil,until);
 assert.equal(r.simulation.cash,50);assert.equal(h.runtime.status().simulationState,'SESSION_ENDED');assert.equal(r.reports.length,2);
});
test('risk-locked simulation keeps researching and cannot resume or reset losses',async t=>{
 const h=harness(t);await h.runtime.cycle();h.set(T+CYCLE_MS);await h.runtime.cycle();const p=h.runtime.status().simulation.positions[0];
 h.set(T+2*CYCLE_MS,p.entry*.2);let r=await h.runtime.cycle();assert.equal(r.simulation.riskLock,'DAILY_LOSS_LIMIT');
 h.set(T+3*CYCLE_MS);r=await h.runtime.cycle();assert.equal(r.health,'RUNNING');assert.equal(r.simulation.enabled,false);assert.ok(r.simulation.cash<49);
 await assert.rejects(h.runtime.control('resume'),/Risk lock/);assert.equal(h.runtime.reports().length,4);
});
test('pool discovery is automatic and preserves existing position pools across rotation',async t=>{
 let selected=POOL,seen=[];const token=memeFixture().tokenAddress;
 const h=harness(t,{config:{selection:'tokens',addresses:[token]},discoveryFactory:()=>({discover:async()=>({pools:[selected],status:'OK',code:'FOUND',source:'token-pools',checkedAt:T})}),
  feedFactory:({pools})=>({snapshots:async()=>{seen=pools;return pools.map(pool=>({...h.row(),poolAddress:pool}));}})});
 await h.runtime.cycle();h.set(T+CYCLE_MS);await h.runtime.cycle();selected=OTHER;h.set(T+2*CYCLE_MS);const r=await h.runtime.cycle();
 assert.deepEqual(seen,[POOL,OTHER]);assert.equal(r.simulation.positions[0].poolAddress,POOL);assert.equal(r.reports.length,4);
});
test('discovery outage preserves pinned position observations',async t=>{
 let fail=false;const h=harness(t,{config:{selection:'tokens',addresses:[memeFixture().tokenAddress]},
  discoveryFactory:()=>({discover:async()=>{if(fail)throw new Error('provider');return {pools:[POOL],status:'OK',source:'token-pools',code:'FOUND',checkedAt:T};}})});
 await h.runtime.cycle();h.set(T+CYCLE_MS);await h.runtime.cycle();fail=true;h.set(T+2*CYCLE_MS);const r=await h.runtime.cycle();
 assert.equal(r.selection.status,'WAIT');assert.deepEqual(r.selection.pools,[POOL]);assert.equal(r.marketData,'OK');assert.equal(r.simulation.positions.length,1);
});
test('unknown or wrong-token market data records WAIT and preserves the ledger',async t=>{
 let fail=false;const h=harness(t,{feedFactory:()=>({snapshots:async()=>{if(fail)throw new Error('private upstream error');return [h.row()];}})});
 await h.runtime.cycle();h.set(T+CYCLE_MS);await h.runtime.cycle();const cash=h.runtime.status().simulation.cash;fail=true;h.set(T+2*CYCLE_MS);const r=await h.runtime.cycle();
 assert.equal(r.marketData,'WAIT');assert.equal(r.simulation.cash,cash);assert.equal(r.simulation.positions.length,1);assert.ok(r.reports.every(x=>x.status==='WAIT'));
 assert.ok(!JSON.stringify(r).includes('private upstream'));
});
test('a candidate pool for a different token cannot enter the simulation',async t=>{
 const h=harness(t,{config:{selection:'tokens',addresses:['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']},discoveryFactory:()=>({discover:async()=>({pools:[POOL],status:'OK',source:'token-pools',code:'FOUND',checkedAt:T})})});
 const r=await h.runtime.cycle();assert.equal(r.marketData,'WAIT');assert.equal(r.simulation.orders.length,0);assert.equal(r.simulation.cash,50);
});
test('concurrent runtime cannot duplicate a scan or auto-start',async t=>{
 let unblock;const h=harness(t,{feedFactory:()=>({snapshots:()=>new Promise(r=>{unblock=r;})})});const pending=h.runtime.cycle();await new Promise(r=>setImmediate(r));
 const other=new GhostRuntime(h.path,{clock:h.clock,feedFactory:h.feedFactory});t.after(()=>other.close());
 await assert.rejects(other.cycle(),/Another runtime/);unblock([h.row()]);await pending;assert.equal(other.reports().length,1);
});
test('an existing simulation ledger is never silently started',async t=>{
 const h=harness(t);h.runtime.close();const db=new DatabaseSync(h.path);db.exec('DROP TABLE ghost_runtime');db.close();
 const reopened=new GhostRuntime(h.path,{config,clock:h.clock,feedFactory:h.feedFactory});t.after(()=>reopened.close());
 const r=await reopened.cycle();assert.equal(r.simulation.enabled,false);assert.equal(r.simulation.orders.length,0);
});
test('invalid configuration, unexpected live flags and changed recovery configuration are rejected',t=>{
 for(const c of [{selection:'all'},{addresses:[]},{addresses:[POOL,POOL]},{addresses:['https://bad']},{live:true},{strategy:'btc-15m'}])assert.throws(()=>validateRuntimeConfig(c));
 const h=harness(t);assert.throws(()=>new GhostRuntime(h.path,{config:{...config,addresses:[OTHER]}}),/configuration differs/);
 assert.throws(()=>configFromEnv({GHOST_BASE_POOLS:POOL,GHOST_BASE_TOKENS:OTHER}));
 assert.deepEqual(configFromEnv({GHOST_BASE_POOLS:POOL}),{selection:'pools',addresses:[POOL]});
 assert.equal(configFromEnv({GHOST_ENABLE_INFERENCE:'true',VIRTUALS_API_KEY:'ignored'}),undefined);
});
test('runtime clock regression and corrupt recovery records stop before data access',async t=>{
 const h=harness(t);await h.runtime.cycle();h.set(T-1);await assert.rejects(h.runtime.cycle(),/regressed/);assert.equal(h.requests,1);
 h.set(T+CYCLE_MS);h.runtime.db.prepare('UPDATE ghost_runtime SET next_cycle=-1').run();await assert.rejects(h.runtime.cycle(),/recovery record/);
});
test('invalid first configuration creates no ledger and a corrected first run starts',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'ghost-invalid-config-')),path=join(dir,'agent.sqlite');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 assert.throws(()=>new GhostRuntime(path,{config:{addresses:['invalid']}}));assert.equal(existsSync(path),false);
 const runtime=new GhostRuntime(path,{config,clock:()=>T,feedFactory:()=>({snapshots:async()=>[memeFixture(T)]})});
 try{assert.equal((await runtime.cycle()).simulation.enabled,true);}finally{runtime.close();}
});
test('clock regression during a fetch cannot mutate the trading ledger or save a report',async t=>{
 const h=harness(t,{feedFactory:()=>({snapshots:async()=>{h.set(T-1000);return [h.row()];}})});
 await assert.rejects(h.runtime.cycle(),/regressed/);
 const s=h.runtime.operator.status();assert.equal(s.lastTick,0);assert.equal(s.orders.length,0);assert.equal(s.cash,50);
 assert.equal(h.runtime.reports().length,0);assert.equal(h.runtime.readControl().last_cycle,T);
});
test('adopting an older open ledger rejects an incompatible watchlist explicitly',async t=>{
 const h=harness(t);await h.runtime.cycle();h.set(T+CYCLE_MS);await h.runtime.cycle();h.runtime.close();
 const db=new DatabaseSync(h.path);db.exec('DROP TABLE ghost_runtime');db.close();
 assert.throws(()=>new GhostRuntime(h.path,{config:{selection:'tokens',addresses:['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']},clock:h.clock}),/outside this watchlist/);
 const reopened=new GhostRuntime(h.path,{config,clock:h.clock,feedFactory:h.feedFactory});
 try{assert.equal(reopened.status().simulation.positions.length,1);}finally{reopened.close();}
});
test('persistent request budget and retry-after survive a runtime restart',async t=>{
 let calls=0;const discoveryFactory=({fetcher})=>({discover:async()=>{await fetcher('https://api.geckoterminal.com/api/v2/networks/base/tokens/'+memeFixture().tokenAddress+'/pools',{method:'GET',credentials:'omit',redirect:'error',signal:new AbortController().signal});return {pools:[],status:'WAIT',code:'NONE',source:'token-pools',checkedAt:T};}});
 const options={config:{selection:'tokens',addresses:[memeFixture().tokenAddress]},discoveryFactory,fetcher:async()=>{calls++;return new Response('limited',{status:429,headers:{'retry-after':'300'}});}};
 const h=harness(t,options);await h.runtime.cycle();assert.equal(calls,1);h.runtime.close();h.set(T+CYCLE_MS);
 const next=new GhostRuntime(h.path,{...options,clock:h.clock});t.after(()=>next.close());await next.cycle();assert.equal(calls,1);assert.equal(next.status().latest.selection.code,'DISCOVERY_UNAVAILABLE');
});
