import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {LiveAgent} from '../live/agent.mjs';
import {validateLiveConfig} from '../live/config.mjs';
import {memeFixture} from '../examples/meme-fixture.mjs';
import {rpcFixture,TOKEN,POOL,OTHER} from './helpers/base-rpc.mjs';

function harness(t){
 const h=rpcFixture(),dir=mkdtempSync(join(tmpdir(),'ghost-live-test-'));h.path=join(dir,'live.sqlite');
 h.row=memeFixture(h.at);h.tokenUsd=h.row.priceUsd;
 h.config={mode:'live',chainId:8453,walletAddress:h.account.address,poolAddress:POOL,tokenAddress:TOKEN,strategy:'volume-breakout'};
 h.feed={snapshots:async()=>[{...h.row,observedAt:h.at,priceUsd:h.tokenUsd,quotePriceUsd:1,quoteTokenAddress:h.quoteToken,nativePriceUsd:3000,nativeObservedAt:h.at,security:{...h.row.security,checkedAt:h.at}}]};
 h.open=()=>new LiveAgent(h.path,{config:h.config,broker:h.broker,feed:h.feed,clock:()=>h.at});h.agent=h.open();
 h.restart=()=>{h.agent.close();h.agent=h.open();};h.next=async()=>{h.at+=15000;return h.agent.cycle();};
 h.prepared=()=>h.agent.read().transaction?.prepared;
 h.fill=async()=>{const p=h.prepared();assert.ok(p);h.mine(p);return h.next();};
 t.after(()=>{try{h.agent.close();}catch{}rmSync(dir,{recursive:true,force:true});});return h;
}
async function enter(h){await h.agent.start();await h.agent.cycle();assert.equal(h.prepared().kind,'APPROVE');await h.fill();assert.equal(h.prepared().kind,'SWAP');await h.fill();assert.ok(h.agent.status().position);}
async function requestExit(h){h.agent.claim();try{const s=h.agent.read();s.position.exitRequested=true;h.agent.save(s);}finally{h.agent.release();}await h.next();}

test('new live journal stays inactive; start allocates only configured capital and preserves baseline tokens',async t=>{
 const h=harness(t);assert.equal((await h.agent.cycle()).diagnostic.code,'LIVE_SESSION_NOT_STARTED');assert.equal(h.signed.length,0);
 const s=await h.agent.start();assert.equal(s.cashQuote,'50000000');assert.equal(s.baselineQuote,'50000000');assert.equal(s.baselineToken,'20000000000000000000');assert.equal(s.position,null);
 assert.equal(statSync(h.path).mode&0o777,0o600);assert.equal(h.agent.db.prepare('PRAGMA synchronous').get().synchronous,2);
});
test('real broker BUY and SELL receipts update SQLite once and preserve allocated wallet balances',async t=>{
 const h=harness(t);await enter(h);const entry=h.agent.status();assert.equal(entry.history.length,2);assert.equal(entry.history[1].kind,'SWAP');
 assert.equal(BigInt(entry.baselineQuote)+BigInt(entry.cashQuote),h.quote);assert.equal(BigInt(entry.baselineToken)+BigInt(entry.position.quantity),h.token);
 h.restart();await h.next();assert.equal(h.agent.status().history.length,2);assert.equal(h.agent.status().cashQuote,entry.cashQuote);
 await requestExit(h);assert.equal(h.prepared().kind,'APPROVE');await h.fill();assert.equal(h.prepared().kind,'SWAP');await h.fill();
 const closed=h.agent.status();assert.equal(closed.position,null);assert.equal(closed.history.length,4);assert.ok(closed.gasSpentUsd>0);assert.equal(closed.realizedUsd,closed.realizedTradingUsd-closed.gasSpentUsd);
 assert.equal(BigInt(closed.baselineQuote)+BigInt(closed.cashQuote),h.quote);h.restart();await h.next();assert.equal(h.agent.status().history.length,4);
});
test('raw signed intent and SUBMITTING reservation are committed before any RPC send',async t=>{
 const h=harness(t),send=h.wallet.sendRawTransaction,observed=[];
 h.wallet.sendRawTransaction=async tx=>{
  const db=new DatabaseSync(h.path,{readOnly:true});const s=JSON.parse(db.prepare('SELECT payload FROM ghost_live WHERE id=1').get().payload);db.close();observed.push({s,tx});return send(tx);
 };
 await h.agent.start();await h.agent.cycle();assert.equal(observed.length,1);assert.equal(h.sent.length,1);
 const {s,tx}=observed[0];assert.equal(s.transaction.phase,'SUBMITTING');assert.equal(s.transaction.broadcasts,1);assert.equal(s.transaction.prepared.rawTransaction,tx.serializedTransaction);
 assert.equal(s.transaction.prepared.amountIn,s.intent.amountIn);assert.equal(s.transaction.prepared.from,h.account.address);assert.ok(!JSON.stringify(h.agent.status()).includes(h.prepared().rawTransaction));
});
for(const phase of ['PREPARED','SUBMITTING'])test(`SQLite failure saving ${phase} prevents broadcast`,async t=>{
 const h=harness(t);await h.agent.start();const save=h.agent.save.bind(h.agent);
 h.agent.save=s=>{if(s.transaction?.phase===phase)throw new Error('simulated disk failure');save(s);};
 await assert.rejects(h.agent.cycle(),/disk failure/);assert.equal(h.sent.length,0);h.restart();
 if(phase==='SUBMITTING'){assert.equal(h.agent.status().transaction.phase,'PREPARED');assert.equal(h.agent.status().transaction.broadcasts,0);}
 await h.next();assert.equal(h.sent.length,1);
});
test('lost broadcast response survives restart and retries the identical signed bytes at most three times',async t=>{
 const h=harness(t),send=h.wallet.sendRawTransaction;h.wallet.sendRawTransaction=async tx=>{await send(tx);throw new Error('response lost after acceptance');};
 await h.agent.start();await h.agent.cycle();const p=h.prepared(),cash=h.agent.status().cashQuote,until=h.agent.status().sessionUntil;
 h.restart();await h.next();await h.next();await h.next();const s=h.agent.status();
 assert.equal(h.signed.length,1);assert.equal(h.sent.length,3);assert.ok(h.sent.every(raw=>raw===p.rawTransaction));assert.equal(s.transaction.hash,p.hash);
 assert.equal(s.transaction.broadcasts,3);assert.equal(s.cashQuote,cash);assert.equal(s.sessionUntil,until);assert.equal(s.position,null);assert.equal(s.history.length,0);
 h.at+=240000;h.restart();await h.next();assert.equal(h.agent.status().transaction.hash,p.hash);assert.equal(h.sent.length,3);
});
test('connection failure before send retains uncertain intent and never allocates a replacement nonce',async t=>{
 const h=harness(t);h.wallet.sendRawTransaction=async()=>{throw new Error('offline');};await h.agent.start();await h.agent.cycle();const p=h.prepared();
 h.restart();await h.next();assert.equal(h.signed.length,1);assert.equal(h.prepared().hash,p.hash);assert.equal(h.agent.status().cashQuote,'50000000');
});
test('mined replacement with missing original receipt locks the journal without releasing cash or signing again',async t=>{
 const h=harness(t);await h.agent.start();await h.agent.cycle();const hash=h.prepared().hash;h.nonce++;
 await h.next();h.restart();await h.next();const s=h.agent.status();assert.equal(s.riskLock,'RECEIPT_MISMATCH');assert.equal(s.enabled,false);
 assert.equal(s.transaction.hash,hash);assert.equal(s.cashQuote,'50000000');assert.equal(s.history.length,0);assert.equal(h.signed.length,1);
});
test('unconfirmed receipt cannot release reservations and becomes bookable only after two confirmations',async t=>{
 const h=harness(t);await h.agent.start();await h.agent.cycle();const p=h.prepared();h.mine(p);h.head=h.block;
 await h.next();assert.equal(h.agent.status().transaction.hash,p.hash);assert.equal(h.agent.status().history.length,0);h.head++;await h.next();assert.equal(h.agent.status().history.length,1);
});
test('partial swap transfer locks the journal; restart does not invent a fill or duplicate the order',async t=>{
 const h=harness(t);await h.agent.start();await h.agent.cycle();await h.fill();const p=h.prepared();h.mine(p,{used:BigInt(p.amountIn)-1n});
 await h.next();h.restart();await h.next();const s=h.agent.status();assert.equal(s.riskLock,'RECEIPT_MISMATCH');assert.equal(s.transaction.hash,p.hash);assert.equal(s.position,null);assert.equal(s.cashQuote,'50000000');assert.equal(h.signed.length,2);
});
test('crash before fill bookkeeping commit replays the receipt exactly once after restart',async t=>{
 const h=harness(t);await h.agent.start();await h.agent.cycle();await h.fill();const p=h.prepared();h.mine(p);
 const save=h.agent.save.bind(h.agent);h.agent.save=s=>{if(s.history.length===2&&!s.transaction)throw new Error('crash before commit');save(s);};
 await assert.rejects(h.next(),/crash before commit/);h.restart();assert.equal(h.agent.status().history.length,1);assert.equal(h.agent.status().transaction.hash,p.hash);
 await h.next();const s=h.agent.status();assert.equal(s.history.length,2);assert.ok(s.position);assert.equal(s.transaction,null);h.restart();await h.next();assert.deepEqual(h.agent.status().history,s.history);
});
test('pause and session expiry preserve submitted reservations across restart without rebroadcasting buys',async t=>{
 const h=harness(t);await h.agent.start();await h.agent.cycle();const p=h.prepared(),until=h.agent.status().sessionUntil;
 h.agent.pause();h.restart();await h.next();assert.equal(h.agent.status().transaction.hash,p.hash);assert.equal(h.sent.length,1);
 h.at=until+1;h.restart();await h.next();assert.equal(h.agent.status().transaction.hash,p.hash);assert.equal(h.sent.length,1);assert.equal(h.agent.status().sessionUntil,until);
 await assert.rejects(h.agent.start(),/Resolve the existing/);
});
test('never-submitted expired PREPARED intent can be cleared without spending or creating a position',async t=>{
 const h=harness(t);await h.agent.start();const save=h.agent.save.bind(h.agent);h.agent.save=s=>{if(s.transaction?.phase==='SUBMITTING')throw new Error('disk failure');save(s);};
 await assert.rejects(h.agent.cycle());h.restart();h.at=h.prepared().deadline*1000+1;await h.next();const s=h.agent.status();assert.equal(s.transaction,null);assert.equal(s.intent,null);assert.equal(s.position,null);assert.equal(s.cashQuote,'50000000');assert.equal(h.sent.length,0);
});
test('external token changes create a durable wallet lock',async t=>{
 const h=harness(t);await h.agent.start();h.quote++;await h.agent.cycle();h.restart();assert.equal(h.agent.status().riskLock,'WALLET_CHANGED');assert.equal(h.signed.length,0);await assert.rejects(h.agent.start(),/lock requires review/);
});
test('two verified failed exits retain the position, stop retries and require explicit retry-exit',async t=>{
 const h=harness(t);await enter(h);await requestExit(h);await h.fill();const quantity=h.agent.status().position.quantity;
 for(let i=1;i<=2;i++){const p=h.prepared();assert.equal(p.kind,'SWAP');h.mine(p,{status:'reverted'});await h.next();assert.equal(h.agent.status().exitFailures,i);}
 const s=h.agent.status();assert.equal(s.riskLock,'EXIT_FAILURE_LIMIT');assert.equal(s.transaction,null);assert.equal(s.position.quantity,quantity);const count=h.signed.length;
 h.restart();await h.next();assert.equal(h.signed.length,count);h.agent.retryExit();assert.equal(h.agent.status().enabled,false);await h.next();assert.equal(h.prepared().side,'SELL');await h.fill();assert.equal(h.agent.status().position,null);
});
test('uncertain failed exit retains transaction and inventory without incrementing the revert counter',async t=>{
 const h=harness(t);await enter(h);await requestExit(h);await h.fill();const p=h.prepared();h.mine(p,{status:'reverted'});h.native++;
 await h.next();h.restart();const s=h.agent.status();assert.equal(s.transaction.hash,p.hash);assert.equal(s.exitFailures,0);assert.ok(s.position);assert.equal(s.riskLock,'RECEIPT_MISMATCH');assert.throws(()=>h.agent.retryExit(),/No failed exit/);
});
test('session cannot be silently extended and pause retains exit monitoring',async t=>{
 const h=harness(t);await enter(h);const until=h.agent.status().sessionUntil;await assert.rejects(h.agent.start(),/cannot be extended/);h.agent.pause();h.restart();h.at=until+1;await h.next();
 assert.equal(h.agent.status().sessionUntil,until);assert.equal(h.agent.status().enabled,false);assert.equal(h.prepared().side,'SELL');
});
test('same journal worker lease and in-process guard prevent concurrent duplicate signing',async t=>{
 const h=harness(t);await h.agent.start();const other=h.open();let release,started;
 const ready=new Promise(r=>{started=r;}),market=h.feed.snapshots;h.feed.snapshots=()=>{started();return new Promise(r=>{release=()=>market().then(r);});};
 const run=h.agent.cycle();await ready;await assert.rejects(h.agent.cycle(),/busy/);await assert.rejects(other.cycle(),/Another live worker/);other.close();release();await run;assert.equal(h.signed.length,1);assert.equal(h.sent.length,1);
});
test('wallet, pool, strategy, risk limits and simulation database remain isolated',async t=>{
 const h=harness(t);for(const change of [{strategy:'btc-15m'},{riskPct:2.1},{slippageBps:101},{sessionHours:25}])assert.throws(()=>validateLiveConfig({...h.config,...change}));
 assert.throws(()=>new LiveAgent(h.path,{config:{...h.config,walletAddress:OTHER},broker:h.broker}),/signer differ/);
 assert.throws(()=>new LiveAgent(h.path,{config:{...h.config,poolAddress:OTHER},broker:h.broker}),/configuration differs/);
 const dbPath=join(tmpdir(),`ghost-sim-${crypto.randomUUID()}.sqlite`),db=new DatabaseSync(dbPath);db.exec('CREATE TABLE ghost_meme(id INTEGER)');db.close();
 try{assert.throws(()=>new LiveAgent(dbPath,{config:h.config,broker:h.broker}),/separate live database/);}finally{rmSync(dbPath,{force:true});}
});
test('missing market data retains pending transaction and redacts provider details',async t=>{
 const h=harness(t);await h.agent.start();await h.agent.cycle();const hash=h.prepared().hash;h.feed.snapshots=async()=>{throw new Error('private provider detail');};
 const s=await h.next();assert.equal(s.diagnostic.code,'MARKET_DATA_UNAVAILABLE');assert.equal(s.transaction.hash,hash);assert.equal(h.signed.length,1);assert.ok(!JSON.stringify(s).includes('private provider'));
});
test('expired worker lease after signing prevents any broadcast',async t=>{
 const h=harness(t);await h.agent.start();const prepare=h.broker.prepare.bind(h.broker);h.broker.prepare=async input=>{const p=await prepare(input);h.at+=300001;return p;};
 await assert.rejects(h.agent.cycle(),/lease expired/);assert.equal(h.signed.length,1);assert.equal(h.sent.length,0);assert.equal(h.agent.status().transaction,null);assert.ok(h.agent.read().intent);
});
test('corrupt persisted intent binding is rejected on restart before signing or broadcasting',async t=>{
 const h=harness(t);await h.agent.start();await h.agent.cycle();const s=h.agent.read();s.transaction.prepared.amountIn='1';
 h.agent.db.prepare('UPDATE ghost_live SET payload=? WHERE id=1').run(JSON.stringify(s));h.agent.close();
 assert.throws(()=>h.open(),/differs from the recorded intent/);assert.equal(h.signed.length,1);assert.equal(h.sent.length,1);
});
