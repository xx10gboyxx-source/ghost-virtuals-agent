import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GrokOperator} from '../operator.mjs';
import {report} from '../agent/reporter.mjs';

// Offline demonstration: synthetic books, no model calls, no credentials.
const start=Date.parse('2026-01-01T00:00:00Z');
let now=start,yes=.65,no=.37;
function market(){return {
  slug:'synthetic-btc-15m',title:'Synthetic BTC window',valid:true,active:true,binary:true,bookOpen:true,
  closeAt:start+900000,sourceAt:now,receivedAt:now,feeCoefficient:.0695,minQuantity:1,tickSize:.01,
  crypto15:{asset:'btc',indexSymbol:'BRTI',startAt:start,endAt:start+900000,priceToBeat:62000},
  yesAsk:yes,noAsk:no,yesBid:yes-.02,noBid:no-.02,
  yesDepth:[{price:yes,quantity:100}],noDepth:[{price:no,quantity:100}],
  yesExitDepth:[{price:yes-.02,quantity:100}],noExitDepth:[{price:no-.02,quantity:100}],
};}
const directory=mkdtempSync(join(tmpdir(),'ghost-demo-'));
const operator=new GrokOperator(join(directory,'simulation.sqlite'),{clock:()=>now,feed:{crypto15:async()=>({markets:[market()]}),markets:async()=>[market()],settlement:async()=>null}});
try {
  const steps=[];
  const capture=async label=>steps.push({step:label,...await report(operator.status())});
  await capture('Fresh install: paused');
  await operator.action('start');await operator.action('tick');await capture('Eligible synthetic entry: pending, not filled');
  now+=5000;await operator.action('tick');await capture('Later synthetic book: simulated fill');
  yes=.84;no=.18;now+=5000;await operator.action('tick');await capture('Protective exit: pending');
  now+=5000;await operator.action('tick');await capture('Later book: simulated exit; same-window re-entry blocked');
  process.stdout.write(JSON.stringify({fixture:'SYNTHETIC_OFFLINE_DEMO',liveOrders:false,modelCalls:0,steps},null,2)+'
');
} finally {operator.close();rmSync(directory,{recursive:true,force:true});}
