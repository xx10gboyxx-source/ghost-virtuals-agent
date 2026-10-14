import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,existsSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkReadiness} from '../scripts/readiness.mjs';
import {memeFixture,FIXTURE_TIME as T} from '../examples/meme-fixture.mjs';

test('passing market and ACP preflight cannot certify absent live trading',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'ghost-ready-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const config=join(dir,'worker.json'),statePath=join(dir,'state.sqlite');
 writeFileSync(config,JSON.stringify({agentId:'01a0ddd4-4982-70d0-b660-0ec5cccd0e12',chainId:8453,statePath}));
 let preflight=0,scans=0;
 const result=await checkReadiness({now:()=>T,pools:[memeFixture().poolAddress],probeFeed:true,acpConfigPath:config,
  feedFactory:()=>({snapshots:async()=>{scans++;return[memeFixture()];}}),
  cliFactory:()=>({preflight:async()=>{preflight++;},run:()=>assert.fail('must not start a worker'),submit:()=>assert.fail('must not sign')})});
 assert.equal(scans,1);assert.equal(preflight,1);assert.equal(result.checks.find(x=>x.id==='market_data').status,'PASS');
 assert.equal(result.checks.find(x=>x.id==='acp_identity_offering').status,'PASS');
 assert.equal(result.readyForFunding,false);assert.equal(result.liveOrders,false);assert.equal(result.fundingAloneStartsTrading,false);assert.equal(existsSync(statePath),false);
});
test('offline readiness neither calls providers nor invents deployment evidence',async()=>{
 const result=await checkReadiness({now:()=>T,feedFactory:()=>({snapshots:()=>assert.fail('offline check must not call providers')}),cliFactory:()=>assert.fail('offline check must not call CLI')});
 assert.equal(result.checks.find(x=>x.id==='market_data').status,'UNVERIFIED');assert.equal(result.checks.find(x=>x.id==='hosted_delivery').status,'UNVERIFIED');
});
test('configuration failures are redacted and missing state is never created',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'ghost-ready-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const result=await checkReadiness({now:()=>T,acpConfigPath:join(dir,'missing.json'),pools:['invalid']});
 assert.equal(result.checks.find(x=>x.id==='pool_configuration').status,'BLOCKED');assert.equal(result.checks.find(x=>x.id==='acp_identity_offering').status,'UNVERIFIED');assert.deepEqual(readdirSync(dir),[]);
 assert.ok(!JSON.stringify(result).includes(dir));
});
test('readiness CLI fails the funding gate even if inherited environment requests live mode',()=>{
 const result=spawnSync(process.execPath,['scripts/readiness.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,GHOST_BASE_POOLS:'',GHOST_LIVE_TRADING:'true'},encoding:'utf8'});
 assert.equal(result.status,2);assert.equal(JSON.parse(result.stdout).readyForFunding,false);
 const bad=spawnSync(process.execPath,['scripts/readiness.mjs','--enable-live'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});assert.equal(bad.status,1);
});
