import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {evaluateMeme} from '../server/meme-strategy.mjs';
import {validateLiveConfig,positive,rawAmount,displayAmount} from './config.mjs';

const INTERVAL=15000,LEASE=300000;
const raw=x=>typeof x==='string'&&/^\d{1,78}$/.test(x);
const time=x=>Number.isSafeInteger(x)&&x>=0;
const day=at=>new Date(at).toISOString().slice(0,10);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const fresh=(x,now,ttl=90000)=>time(x)&&x>0&&x<=now&&now-x<=ttl;
const initial=()=>({version:1,mode:'live',initialized:false,enabled:false,sessionUntil:0,lastCycleAt:0,nextCycleAt:0,
 cashQuote:'0',baselineQuote:'0',baselineToken:'0',tokenDecimals:0,quoteDecimals:0,quoteToken:null,
 position:null,intent:null,transaction:null,history:[],signals:[],gasSpentUsd:0,spentUsd:0,
 exitFailures:0,realizedTradingUsd:0,initialEquity:0,peakEquity:0,lastEquity:0,day:null,dayStartEquity:0,riskLock:null,diagnostic:null});

// Trading state is separate from the simulation ledger. No simulated fill can
// enter this state: only broker-confirmed receipts advance positions and cash.
export class LiveAgent {
 constructor(path,{config,broker,feed,clock=Date.now}){
  this.config=validateLiveConfig(config);this.broker=broker;this.feed=feed;this.clock=clock;this.floor=0;this.busy=false;this.lease=null;
  if(!same(broker.address,this.config.walletAddress))throw new Error('Configured wallet and signer differ.');
  mkdirSync(dirname(resolve(path)),{recursive:true,mode:0o700});this.db=new DatabaseSync(path);chmodSync(path,0o600);
  try{
   if(this.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('ghost_meme','ghost_grok')").get())throw new Error('Use a separate live database; simulation balances are never imported.');
   this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS ghost_live(id INTEGER PRIMARY KEY CHECK(id=1),config TEXT NOT NULL,payload TEXT NOT NULL,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0);');
   this.db.prepare('INSERT OR IGNORE INTO ghost_live(id,config,payload) VALUES(1,?,?)').run(JSON.stringify(this.config),JSON.stringify(initial()));this.read();
  }catch(error){this.db.close();throw error;}
 }
 now(){const at=this.clock();if(!time(at)||at===0||at<this.floor)throw new Error('Invalid or regressed live clock.');this.floor=at;return at;}
 read(){
  const row=this.db.prepare('SELECT * FROM ghost_live WHERE id=1').get();
  if(row?.config!==JSON.stringify(this.config))throw new Error('Live configuration differs from the persisted wallet session.');
  let s;try{s=JSON.parse(row.payload);}catch{throw new Error('Invalid live journal.');}
  this.validate(s);return s;
 }
 validate(s){
  if(!s||s.version!==1||s.mode!=='live'||typeof s.initialized!=='boolean'||typeof s.enabled!=='boolean'||
   !['sessionUntil','lastCycleAt','nextCycleAt'].every(k=>time(s[k]))||s.nextCycleAt<s.lastCycleAt||
   !['cashQuote','baselineQuote','baselineToken'].every(k=>raw(s[k]))||
   !['gasSpentUsd','spentUsd','initialEquity','peakEquity','lastEquity','dayStartEquity'].every(k=>finite(s[k])&&s[k]>=0)||!finite(s.realizedTradingUsd)||
   !Number.isInteger(s.exitFailures)||s.exitFailures<0||s.exitFailures>2||!Array.isArray(s.history)||s.history.length>500||!Array.isArray(s.signals)||s.signals.length>1000||
   ![null,'DAILY_LOSS_LIMIT','DRAWDOWN_LIMIT','WALLET_CHANGED','RECEIPT_MISMATCH','EXIT_FAILURE_LIMIT'].includes(s.riskLock))throw new Error('Invalid live journal.');
  if(!Number.isInteger(s.tokenDecimals)||s.tokenDecimals<0||s.tokenDecimals>36||!Number.isInteger(s.quoteDecimals)||s.quoteDecimals<0||s.quoteDecimals>36||s.initialized&&(!/^0x[0-9a-f]{40}$/i.test(s.quoteToken)||s.initialEquity<=0||!s.day)||s.signals.some(x=>typeof x!=='string'||x.length>20))throw new Error('Invalid live assets.');
  if(s.position&&(!raw(s.position.quantity)||BigInt(s.position.quantity)<=0n||!positive(s.position.entry)||!positive(s.position.stop)||!positive(s.position.takeProfit)||!positive(s.position.costUsd)||s.position.stop>=s.position.entry||s.position.takeProfit<=s.position.entry))throw new Error('Invalid live position.');
  if(s.intent&&(!['BUY','SELL'].includes(s.intent.side)||!raw(s.intent.amountIn)||BigInt(s.intent.amountIn)<=0n||!time(s.intent.expiresAt)||!Number.isInteger(s.intent.steps)||s.intent.steps<0||s.intent.steps>3))throw new Error('Invalid live intent.');
  if(s.intent?.side==='BUY'&&(!positive(s.intent.stopRatio)||s.intent.stopRatio>=1||!positive(s.intent.targetRatio)||s.intent.targetRatio<=1||typeof s.intent.signal!=='string'||s.position)||s.intent?.side==='SELL'&&(!s.position||s.intent.amountIn!==s.position.quantity)||s.intent&&!positive(s.intent.quotePriceUsd))throw new Error('Invalid live intent binding.');
  if(s.transaction&&(!s.intent||!['PREPARED','SUBMITTING'].includes(s.transaction.phase)||!/^0x[0-9a-f]{64}$/i.test(s.transaction.prepared?.hash)||typeof s.transaction.prepared?.rawTransaction!=='string'||!Number.isInteger(s.transaction.broadcasts)||s.transaction.broadcasts<0||s.transaction.broadcasts>3))throw new Error('Invalid live transaction journal.');
  if(s.transaction){const p=s.transaction.prepared;if(p.side!==s.intent.side||p.amountIn!==s.intent.amountIn||!same(p.poolAddress,this.config.poolAddress)||!same(p.tokenAddress,this.config.tokenAddress)||!same(p.from,this.config.walletAddress)||!same(p.quoteToken,s.quoteToken)||p.slippageBps!==this.config.slippageBps||p.maxPriceImpactBps!==this.config.maxPriceImpactBps||p.deadline!==Math.floor(s.intent.expiresAt/1000))throw new Error('Live signed transaction differs from the recorded intent.');}
 }
 claim(){
  const at=this.now(),s=this.read();if(at<s.lastCycleAt)throw new Error('Live clock regressed.');
  const token=crypto.randomUUID(),r=this.db.prepare('UPDATE ghost_live SET lease=?,lease_until=? WHERE id=1 AND (lease IS NULL OR lease_until<=?)').run(token,at+LEASE,at);
  if(!r.changes)throw new Error('Another live worker owns this wallet journal.');this.lease=token;
 }
 assertLease(){const r=this.db.prepare('SELECT lease,lease_until FROM ghost_live WHERE id=1').get();if(!this.lease||r.lease!==this.lease||r.lease_until<=this.now())throw new Error('Live worker lease expired.');}
 save(s){
  this.assertLease();
  this.validate(s);const payload=JSON.stringify(s,(_k,v)=>{if(typeof v==='number'&&!Number.isFinite(v))throw new Error('Invalid live arithmetic.');return v;});if(payload.length>2000000)throw new Error('Live journal size limit.');
  const r=this.db.prepare('UPDATE ghost_live SET payload=? WHERE id=1 AND lease=? AND lease_until>?').run(payload,this.lease,this.now());if(!r.changes)throw new Error('Live journal lease lost.');
 }
 release(){if(this.lease)this.db.prepare('UPDATE ghost_live SET lease=NULL,lease_until=0 WHERE id=1 AND lease=?').run(this.lease);this.lease=null;}
 status(){
  const s=this.read(),transaction=s.transaction?{phase:s.transaction.phase,hash:s.transaction.prepared.hash,kind:s.transaction.prepared.kind,broadcasts:s.transaction.broadcasts}:null;
  return {...s,transaction,walletAddress:this.config.walletAddress,chainId:8453,strategy:this.config.strategy,
   mode:'live',liveOrders:true,realizedUsd:s.realizedTradingUsd-s.gasSpentUsd};
 }
 retryExit(){this.claim();try{const s=this.read();if(!s.position||s.transaction||s.exitFailures<2)throw new Error('No failed exit is available for retry.');s.exitFailures=0;if(s.riskLock==='EXIT_FAILURE_LIMIT')s.riskLock=null;s.enabled=false;s.intent={side:'SELL',amountIn:s.position.quantity,expiresAt:this.now()+180000,steps:0,quotePriceUsd:1};this.save(s);return this.status();}finally{this.release();}}
 async market(){
  const rows=await this.feed.snapshots(),at=this.now(),m=rows?.[0];
  if(!Array.isArray(rows)||rows.length!==1||m?.chainId!==8453||!same(m.poolAddress,this.config.poolAddress)||!same(m.tokenAddress,this.config.tokenAddress)||!fresh(m.observedAt,at)||!fresh(m.nativeObservedAt,at)||!positive(m.priceUsd)||!positive(m.quotePriceUsd)||!positive(m.nativePriceUsd))throw new Error('Fresh bound market and gas prices are unavailable.');
  return m;
 }
 async check(){
  const market=await this.market(),wallet=await this.broker.inspect(this.config);
  if(!same(market.quoteTokenAddress,wallet.quoteToken))throw new Error('Market and on-chain quote assets differ.');
  const availableUsd=displayAmount(wallet.quoteBalance,wallet.quoteDecimals)*market.quotePriceUsd;
  if(!finite(availableUsd))throw new Error('Invalid market valuation.');
  const gasReserveWei=BigInt(this.config.maxGasWei)*6n;
  return {mode:'live',chainId:8453,walletAddress:this.config.walletAddress,poolAddress:this.config.poolAddress,tokenAddress:this.config.tokenAddress,
   quoteToken:wallet.quoteToken,quoteBalance:wallet.quoteBalance,nativeBalance:wallet.nativeBalance,
   availableQuoteUsd:availableUsd,capitalUsd:this.config.capitalUsd,gasReserveWei:String(gasReserveWei),
   funded:availableUsd>=this.config.capitalUsd&&BigInt(wallet.nativeBalance)>=gasReserveWei,
   strategyDecision:evaluateMeme(market,{strategy:this.config.strategy,now:this.now()}),
   wallet,market};
 }
 async start(){
  if(this.busy)throw new Error('Live worker is busy.');this.claim();
  try{
   const s=this.read(),at=this.now();
   if(s.riskLock)throw new Error('Saved loss or reconciliation lock requires review.');
   if(s.enabled&&s.sessionUntil>at)throw new Error('The active live session cannot be extended.');
   if(s.sessionUntil<=at&&(s.position||s.intent||s.transaction))throw new Error('Resolve the existing position and transaction before a new entry session.');
   if(!s.initialized){
    const c=await this.check();this.assertLease();if(!c.funded)throw new Error('Configured quote capital and ETH gas reserve are not available in this wallet.');
    const cash=rawAmount(this.config.capitalUsd/c.market.quotePriceUsd,c.wallet.quoteDecimals);if(cash<=0n||cash>BigInt(c.wallet.quoteBalance))throw new Error('Capital cannot be allocated from this wallet.');
    Object.assign(s,{initialized:true,cashQuote:String(cash),baselineQuote:String(BigInt(c.wallet.quoteBalance)-cash),baselineToken:c.wallet.tokenBalance,
     tokenDecimals:c.wallet.tokenDecimals,quoteDecimals:c.wallet.quoteDecimals,quoteToken:c.wallet.quoteToken,
     initialEquity:displayAmount(cash,c.wallet.quoteDecimals)*c.market.quotePriceUsd});
    s.peakEquity=s.lastEquity=s.dayStartEquity=s.initialEquity;s.day=day(at);
   }
   if(s.sessionUntil<=at){s.sessionUntil=at+this.config.sessionHours*3600000;s.spentUsd=0;}
   s.enabled=true;this.save(s);return this.status();
  }finally{this.release();}
 }
 pause(){this.claim();try{const s=this.read();s.enabled=false;if(!s.transaction&&s.intent?.side==='BUY')s.intent=null;else if(s.intent?.side==='BUY'&&s.transaction?.phase==='PREPARED'&&s.transaction.broadcasts===0){s.transaction=null;s.intent=null;}this.save(s);return this.status();}finally{this.release();}}
 mark(s,m){
  const valuation=displayAmount(s.cashQuote,s.quoteDecimals)*m.quotePriceUsd+(s.position?displayAmount(s.position.quantity,s.tokenDecimals)*m.priceUsd:0)-s.gasSpentUsd;
  if(!finite(valuation))throw new Error('Market valuation exceeds supported range.');
  const equity=Math.max(0,valuation);
  if(s.day!==day(this.now())){s.dayStartEquity=Math.max(s.lastEquity,equity);s.day=day(this.now());}
  s.peakEquity=Math.max(s.peakEquity,equity);s.lastEquity=equity;
  if(!s.riskLock&&s.dayStartEquity-equity>=this.config.maxDailyLossUsd)s.riskLock='DAILY_LOSS_LIMIT';
  if(!s.riskLock&&s.peakEquity-equity>=this.config.maxDrawdownUsd)s.riskLock='DRAWDOWN_LIMIT';
  if(s.riskLock||this.now()>=s.sessionUntil)s.enabled=false;
 }
 intentInput(s,m){
  return {poolAddress:this.config.poolAddress,tokenAddress:this.config.tokenAddress,side:s.intent.side,amountIn:s.intent.amountIn,
   slippageBps:this.config.slippageBps,maxPriceImpactBps:this.config.maxPriceImpactBps,deadline:Math.floor(s.intent.expiresAt/1000),
   reference:{tokenPriceUsd:m.priceUsd,quotePriceUsd:m.quotePriceUsd,observedAt:m.observedAt,quoteTokenAddress:s.quoteToken}};
 }
 async reconcile(s,m){
  if(!s.transaction)return;
  const t=s.transaction,p=t.prepared,r=await this.broker.reconcile(p);this.assertLease();
  if(r.status==='PENDING'){
   if(t.broadcasts<3&&this.now()<s.intent.expiresAt&&(s.intent.side==='SELL'||(s.enabled&&this.now()<s.sessionUntil&&!s.riskLock)))await this.broadcast(s);
   s.diagnostic={code:'TRANSACTION_PENDING',hash:p.hash};return;
  }
  if(!['CONFIRMED','REVERTED'].includes(r.status)||!raw(r.gasWei)){
   s.riskLock='RECEIPT_MISMATCH';s.enabled=false;s.diagnostic={code:'TRANSACTION_RECONCILIATION_REQUIRED',hash:p.hash};return;
  }
  const gasUsd=displayAmount(r.gasWei,18)*m.nativePriceUsd;
  s.gasSpentUsd+=gasUsd;s.spentUsd+=gasUsd;
  const record={hash:p.hash,kind:p.kind,side:s.intent.side,status:r.status,gasWei:r.gasWei,gasUsd,at:this.now()};
  if(r.status==='CONFIRMED'&&p.kind==='SWAP'){
   if(!raw(r.amountIn)||!raw(r.amountOut)||r.amountIn!==s.intent.amountIn||BigInt(r.amountOut)<=0n)throw new Error('Confirmed fill does not match the recorded intent.');
   if(s.intent.side==='BUY'){
    if(s.position||BigInt(s.cashQuote)<BigInt(r.amountIn))throw new Error('Buy receipt cannot be booked against this allocation.');
    const costUsd=displayAmount(r.amountIn,s.quoteDecimals)*s.intent.quotePriceUsd,quantity=displayAmount(r.amountOut,s.tokenDecimals),entry=costUsd/quantity;
    s.cashQuote=String(BigInt(s.cashQuote)-BigInt(r.amountIn));s.spentUsd+=costUsd;
    s.position={quantity:r.amountOut,costUsd,entry,stop:entry*s.intent.stopRatio,takeProfit:entry*s.intent.targetRatio,exitRequested:false,openedAt:this.now(),buyHash:p.hash};
   }else{
    if(!s.position||s.position.quantity!==r.amountIn)throw new Error('Sell receipt cannot be booked against this position.');
    s.cashQuote=String(BigInt(s.cashQuote)+BigInt(r.amountOut));s.realizedTradingUsd+=displayAmount(r.amountOut,s.quoteDecimals)*m.quotePriceUsd-s.position.costUsd;s.position=null;s.exitFailures=0;
   }
   Object.assign(record,{amountIn:r.amountIn,amountOut:r.amountOut});s.intent=null;
  }else if(r.status==='REVERTED'){if(s.intent.side==='SELL'){s.exitFailures++;if(s.exitFailures>=2){s.riskLock??='EXIT_FAILURE_LIMIT';s.enabled=false;}}s.intent=null;}
  else s.intent.steps++;
  s.history.push(record);s.history=s.history.slice(-500);s.transaction=null;
  // Fill, gas and journal clearance are one SQLite commit, preventing replayed bookkeeping.
  this.save(s);
 }
 async broadcast(s){
  this.assertLease();const t=s.transaction;if(s.intent?.side==='BUY'&&(!s.enabled||s.riskLock||this.now()>=s.sessionUntil||this.now()>=s.intent.expiresAt)){if(t?.phase==='PREPARED'&&t.broadcasts===0){s.transaction=null;s.intent=null;}s.enabled=false;s.diagnostic={code:'ENTRY_SESSION_CLOSED'};this.save(s);return false;}if(!t||t.broadcasts>=3)throw new Error('No bounded transaction submission is available.');
  t.phase='SUBMITTING';t.broadcasts++;this.save(s);
  try{await this.broker.broadcast(t.prepared);}catch{/* The same hash remains unresolved. Never prepare another nonce. */}
  this.assertLease();
 }
 async cycle(){
  if(this.busy)throw new Error('Live worker is busy.');this.busy=true;
  try{
   this.claim();const s=this.read(),at=this.now();
   if(at<s.nextCycleAt)return this.status();
   s.lastCycleAt=at;s.nextCycleAt=at+INTERVAL;this.save(s);
   if(!s.initialized){s.diagnostic={code:'LIVE_SESSION_NOT_STARTED'};this.save(s);return this.status();}
   let m;try{m=await this.market();}catch{s.diagnostic={code:'MARKET_DATA_UNAVAILABLE'};this.save(s);return this.status();}
   this.assertLease();
   this.mark(s,m);
   if(s.transaction?.phase==='PREPARED'&&s.transaction.broadcasts===0&&this.now()>=s.intent.expiresAt){s.transaction=null;s.intent=null;this.save(s);}
   if(s.transaction){await this.reconcile(s,m);if(s.transaction){this.save(s);return this.status();}}
   const wallet=await this.broker.inspect(this.config);this.assertLease();
   if(!same(m.quoteTokenAddress,s.quoteToken)||!same(wallet.quoteToken,s.quoteToken)||wallet.tokenDecimals!==s.tokenDecimals||wallet.quoteDecimals!==s.quoteDecimals||
    BigInt(wallet.quoteBalance)!==BigInt(s.baselineQuote)+BigInt(s.cashQuote)||BigInt(wallet.tokenBalance)!==BigInt(s.baselineToken)+BigInt(s.position?.quantity??'0')){
    s.riskLock='WALLET_CHANGED';s.enabled=false;s.diagnostic={code:'WALLET_RECONCILIATION_REQUIRED'};this.save(s);return this.status();
   }
   this.mark(s,m);
   if(s.intent&&(this.now()>=s.intent.expiresAt||(s.intent.side==='BUY'&&!s.enabled)||s.intent.steps>=3))s.intent=null;
   if(s.exitFailures>=2){s.diagnostic={code:'EXIT_FAILURE_LIMIT',reason:'Two confirmed exit reverts. Resolve the route or gas problem, then use retry-exit.'};this.save(s);return this.status();}
   const decision=evaluateMeme(m,{strategy:this.config.strategy,now:this.now()});
   s.diagnostic={code:decision.code,status:decision.status,reason:decision.reason,checkedAt:this.now()};
   const gasCeilingUsd=displayAmount(this.config.maxGasWei,18)*m.nativePriceUsd;
   if(!s.intent&&s.position&&s.exitFailures<2&&(s.position.exitRequested||m.priceUsd<=s.position.stop||m.priceUsd>=s.position.takeProfit||s.riskLock||this.now()>=s.sessionUntil)){
    s.position.exitRequested=true;s.intent={side:'SELL',amountIn:s.position.quantity,expiresAt:this.now()+180000,steps:0,quotePriceUsd:m.quotePriceUsd};
   }
   if(!s.intent&&!s.position&&s.enabled&&!s.riskLock&&decision.status==='PASS'){
    const signal=String(decision.plan.signalAt);
    if(!s.signals.includes(signal)){
     const stopRatio=decision.plan.stop/decision.plan.entry,targetRatio=decision.plan.takeProfit/decision.plan.entry;
     const fee=wallet.fee/1000000,lossFraction=1-stopRatio+2*this.config.slippageBps/10000+2*fee;
     const risk=s.lastEquity*this.config.riskPct/100-6*gasCeilingUsd;
     const notional=Math.min(this.config.maxPositionUsd,risk/lossFraction,this.config.maxSessionSpendUsd-s.spentUsd-3*gasCeilingUsd,displayAmount(s.cashQuote,s.quoteDecimals)*m.quotePriceUsd-3*gasCeilingUsd);
     if(positive(notional)){
      const amount=rawAmount(notional/m.quotePriceUsd,s.quoteDecimals);
      if(amount>0n)s.intent={side:'BUY',amountIn:String(amount),expiresAt:Math.min(this.now()+180000,s.sessionUntil),steps:0,signal,stopRatio,targetRatio,quotePriceUsd:m.quotePriceUsd};
     }else s.diagnostic={code:'COST_OR_RISK_BUDGET',reason:'The actual route and gas ceilings consume the available entry budget.'};
    }
   }
   if(s.intent){
    if(!/^0(?:\.0+)?$/.test(m.security?.flags?.buy_tax??'')||!/^0(?:\.0+)?$/.test(m.security?.flags?.sell_tax??'')||!fresh(m.security?.checkedAt,this.now(),300000)){
     s.diagnostic={code:'UNSUPPORTED_TRANSFER_TAX',reason:'The supported v3 route requires fresh zero-transfer-tax evidence.'};this.save(s);return this.status();
    }
    if(s.intent.side==='BUY'&&(decision.status!=='PASS'||String(decision.plan.signalAt)!==s.intent.signal)){s.intent=null;this.save(s);return this.status();}
    const requiredGas=BigInt(this.config.maxGasWei)*BigInt((s.intent.side==='BUY'?6:3)-s.intent.steps);
    if(BigInt(wallet.nativeBalance)<requiredGas){s.diagnostic={code:'INSUFFICIENT_ETH_GAS'};this.save(s);return this.status();}
    if(s.intent.side==='BUY'){
     const cost=displayAmount(s.intent.amountIn,s.quoteDecimals)*m.quotePriceUsd;
     if(cost>this.config.maxPositionUsd||cost+3*gasCeilingUsd>this.config.maxSessionSpendUsd-s.spentUsd){s.intent=null;s.diagnostic={code:'ENTRY_BUDGET_CHANGED'};this.save(s);return this.status();}
     const quoted=await this.broker.quote(this.intentInput(s,m));this.assertLease();
     const targetNet=displayAmount(quoted.minOut,s.tokenDecimals)*decision.plan.takeProfit*(1-this.config.slippageBps/10000-wallet.fee/1000000)-3*gasCeilingUsd;
     if(targetNet<=cost+3*gasCeilingUsd){s.intent=null;s.diagnostic={code:'NET_TARGET_COST_LIMIT'};this.save(s);return this.status();}
    }
    s.intent.quotePriceUsd=m.quotePriceUsd;this.save(s);
    const prepared=await this.broker.prepare(this.intentInput(s,m));this.assertLease();
    if(s.intent.side==='BUY'&&!s.signals.includes(s.intent.signal))s.signals=[...s.signals,s.intent.signal].slice(-1000);
    s.transaction={phase:'PREPARED',prepared,broadcasts:0};this.save(s);
    if(await this.broadcast(s)!==false)s.diagnostic={code:'TRANSACTION_SUBMITTED',hash:prepared.hash,kind:prepared.kind};
   }
   this.mark(s,m);this.save(s);return this.status();
  }finally{this.release();this.busy=false;}
 }
 close(){if(this.busy)throw new Error('Wait for the live cycle to finish.');this.release();this.db.close();}
}
