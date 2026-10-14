import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {GhostRuntime,CYCLE_MS} from '../agent/runtime.mjs';
import {memeFixture,FIXTURE_TIME} from './meme-fixture.mjs';

// Deterministic synthetic data exercises the production runtime and operator.
// No network, credentials or real money. It is not a performance backtest.
const dir=mkdtempSync(join(tmpdir(),'ghost-runtime-demo-')),path=join(dir,'demo.sqlite');
let at=FIXTURE_TIME,row=memeFixture(at),runtime;
const config={selection:'pools',addresses:[row.poolAddress]};
const options={clock:()=>at,feedFactory:()=>({snapshots:async()=>[structuredClone(row)]})};
function advance(price=row.priceUsd){at+=CYCLE_MS;row={...row,observedAt:at,priceUsd:price,security:{...row.security,checkedAt:at}};}
try{
 runtime=new GhostRuntime(path,{...options,config});
 await runtime.cycle();advance();await runtime.cycle();
 const position=runtime.status().simulation.positions[0];assert.ok(position);
 advance(position.takeProfit*1.001);await runtime.cycle();
 advance();const result=await runtime.cycle();
 assert.equal(result.simulation.positions.length,0);
 assert.ok(result.simulation.orders.some(o=>o.action==='SELL'&&o.status==='FILLED'));
 runtime.close();runtime=new GhostRuntime(path,options);
 assert.equal(runtime.reports().length,4);
 console.log(JSON.stringify({scenario:'SYNTHETIC_OFFLINE_DEMO',agent:'GhOsT',walletRequired:false,
  liveOrders:false,cycles:4,strategies:['volume-breakout','trend-pullback'],
  simulatedBuyAndSell:'PASSED',restartRecovery:'PASSED',
  initialSimulatedCash:50,finalSimulatedCash:runtime.status().simulation.cash,
  savedReports:runtime.reports().reduce((sum,c)=>sum+c.reports.length,0)},null,2));
}finally{runtime?.close();rmSync(dir,{recursive:true,force:true});}
