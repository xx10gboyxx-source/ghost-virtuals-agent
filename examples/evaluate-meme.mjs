import {evaluateMeme} from '../server/meme-strategy.mjs';
import {memeFixture,FIXTURE_TIME as now} from './meme-fixture.mjs';
const cases=[
 ['eligible-breakout',s=>s,'PASS'],
 ['wrong-chain',s=>({...s,chainId:1}),'BLOCKED'],
 ['unknown-security',s=>({...s,security:null}),'WAIT'],
 ['honeypot',s=>{s.security.flags.is_honeypot='1';return s;},'BLOCKED'],
 ['concentrated-holders',s=>{s.security.top10HolderPct=60;return s;},'BLOCKED'],
 ['low-liquidity',s=>({...s,liquidityUsd:1000}),'WAIT'],
 ['stale-quote',s=>({...s,observedAt:now-90001}),'WAIT'],
 ['future-quote',s=>({...s,observedAt:now+1}),'WAIT'],
 ['weak-volume',s=>{s.candles.at(-1).volume=100;return s;},'WAIT'],
 ['candle-gap',s=>{s.candles.splice(20,1);return s;},'WAIT'],
].map(([name,change,expected])=>{const actual=evaluateMeme(change(memeFixture()),{now}).status;return {name,expected,actual,passed:actual===expected};});
const result={kind:'synthetic-base-meme-evaluation',liveProviderCalls:0,profitabilityMeasured:false,cases,passed:cases.filter(c=>c.passed).length,failed:cases.filter(c=>!c.passed).length};
process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.failed)process.exitCode=1;
