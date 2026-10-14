import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemeOperator} from '../operator.mjs';
import {report} from '../agent/reporter.mjs';
import {memeFixture,FIXTURE_TIME} from './meme-fixture.mjs';
let now=FIXTURE_TIME,snapshot=memeFixture();
const directory=mkdtempSync(join(tmpdir(),'ghost-meme-demo-'));
const operator=new MemeOperator(join(directory,'simulation.sqlite'),{clock:()=>now,feed:{snapshots:async()=>[snapshot]}});
const advance=()=>{now+=15000;snapshot.observedAt=now;snapshot.security.checkedAt=now;};
try{
 const steps=[],capture=async step=>steps.push({step,...await report(operator.status())});
 await capture('Base meme-coin paper account starts paused');
 await operator.action('start');await operator.action('tick');await capture('Synthetic volume breakout creates a pending spot entry');
 advance();await operator.action('tick');await capture('Later quote models the entry and its costs');
 const position=operator.status().positions[0];
 if(!position)throw new Error('Synthetic entry did not qualify.');
 snapshot.priceUsd=position.takeProfit*1.01;
 advance();await operator.action('tick');await capture('Target requests a paper sale');
 advance();await operator.action('tick');await capture('Later quote models the exit');
 process.stdout.write(JSON.stringify({fixture:'SYNTHETIC_BASE_MEME_DEMO',marketKind:'base-meme-spot',liveOrders:false,modelCalls:0,steps},null,2)+'\n');
}finally{operator.close();rmSync(directory,{recursive:true,force:true});}
