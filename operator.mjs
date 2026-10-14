import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createBaseMemeFeed} from './server/base-meme-feed.mjs';
import {evaluateMeme,screenMeme,STRATEGIES} from './server/meme-strategy.mjs';

export const AGENT_ID='ghost-virtuals-agent';
export const PAPER_LIMITS=Object.freeze({initialCash:50,riskPct:0.5,maxPositionUsd:5,maxSessionSpend:50,maxDailyLossUsd:1.5,maxDrawdownUsd:5,feeRate:0.003,slippageRate:0.01,gasUsd:0.02,sessionMs:4*3600000,orderExpiryMs:180000});
function assertFiniteState(value){
 if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Nonfinite simulation result; ledger was not saved.');
 if(value&&typeof value==='object')for(const item of Object.values(value))assertFiniteState(item);
}
const utcDay=at=>new Date(at).toISOString().slice(0,10);
const fresh=(stamp,at)=>Number.isSafeInteger(stamp)&&stamp>0&&stamp<=at&&at-stamp<=90000;
const key=s=>`${s.tokenAddress.toLowerCase()}:${s.poolAddress.toLowerCase()}`;
const diagnostic=(status,code,at,reason)=>({status,code,checkedAt:at,reason});
const buyFactor=tax=>(1+PAPER_LIMITS.slippageRate)*(1+PAPER_LIMITS.feeRate)/(1-tax);
const sellFactor=tax=>(1-PAPER_LIMITS.slippageRate)*(1-PAPER_LIMITS.feeRate)*(1-tax);
const taxes=s=>({buy:Number(s.security.flags.buy_tax),sell:Number(s.security.flags.sell_tax)});
function initialState(strategy){return {version:3,marketKind:'base-meme-spot',chainId:8453,mode:'simulation',strategy,enabled:false,sessionUntil:0,cash:50,realized:0,feesPaid:0,spent:0,positions:[],orders:[],diagnostics:[],entered:[],lastTick:0,peakEquity:50,lastEquity:50,day:null,dayStartEquity:50,riskLock:null};}
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const stamp=x=>Number.isSafeInteger(x)&&x>=0;
const positive=x=>Number.isFinite(x)&&x>0;
const address=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x)&&!/^0x0{40}$/i.test(x);
const market=x=>record(x)&&address(x.tokenAddress)&&address(x.poolAddress)&&x.tokenAddress.toLowerCase()!==x.poolAddress.toLowerCase()&&x.marketKey===key(x);
const prices=x=>positive(x.entry)&&positive(x.stop)&&positive(x.takeProfit)&&x.stop<x.entry&&x.entry<x.takeProfit;
const validDay=x=>x===null||(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&utcDay(Date.parse(x))===x);
function validState(s){
 if(!record(s)||s.version!==3||s.marketKind!=='base-meme-spot'||s.chainId!==8453||s.mode!=='simulation'||!STRATEGIES.includes(s.strategy)||
  typeof s.enabled!=='boolean'||!stamp(s.sessionUntil)||!stamp(s.lastTick)||(s.enabled&&s.sessionUntil===0)||
  !Number.isFinite(s.realized)||!['cash','feesPaid','spent','peakEquity','lastEquity','dayStartEquity'].every(k=>Number.isFinite(s[k])&&s[k]>=0)||
  !validDay(s.day)||![null,'DAILY_LOSS_LIMIT','DRAWDOWN_LIMIT'].includes(s.riskLock)||
  !['positions','orders','entered','diagnostics'].every(k=>Array.isArray(s[k]))||s.positions.length>1||s.orders.length>101||s.entered.length>1000||s.diagnostics.length>32)return false;
 if(!s.positions.every(p=>market(p)&&prices(p)&&positive(p.quantity)&&positive(p.cost)&&stamp(p.openedAt)&&p.openedAt>0&&p.strategy===s.strategy))return false;
 const booked=s.cash+s.positions.reduce((sum,p)=>sum+p.cost,0),expected=PAPER_LIMITS.initialCash+s.realized;
 if(!Number.isFinite(booked)||!Number.isFinite(expected)||Math.abs(booked-expected)>1e-8*Math.max(1,Math.abs(booked),Math.abs(expected)))return false;
 const ids=new Set();let pending=0;
 for(const o of s.orders){
  if(!market(o)||typeof o.id!=='string'||!/^[-0-9a-f]{36}$/i.test(o.id)||ids.has(o.id)||o.side!=='SPOT'||
   !['BUY','SELL'].includes(o.action)||!['PENDING','FILLED','CANCELLED'].includes(o.status)||!stamp(o.createdAt)||o.createdAt===0||
   !stamp(o.observedAt)||o.observedAt===0||o.observedAt>o.createdAt)return false;
  ids.add(o.id);
  if(o.action==='BUY'&&(!prices(o)||!positive(o.quantity)||o.strategy!==s.strategy||!stamp(o.signalAt)||o.signalAt===0||o.signalAt>o.createdAt||!stamp(o.expiresAt)||o.expiresAt-o.createdAt!==PAPER_LIMITS.orderExpiryMs))return false;
  if(o.action==='SELL'&&!['STOP_LOSS','TAKE_PROFIT','RISK_EXIT','SESSION_EXIT'].includes(o.exitReason))return false;
  if(o.status==='FILLED'&&(!stamp(o.filledAt)||o.filledAt<=o.createdAt||!positive(o.fillPrice)||!positive(o.quantity)||(o.action==='SELL'&&!Number.isFinite(o.realized))))return false;
  if(o.status==='PENDING'){
   pending++;
   if(o.action==='BUY'?s.positions.length!==0:!s.positions.some(p=>p.marketKey===o.marketKey))return false;
  }
 }
 return pending<=1&&s.entered.every(x=>typeof x==='string'&&x.length<=200)&&
  s.diagnostics.every(x=>record(x)&&['PASS','WAIT','BLOCKED'].includes(x.status)&&typeof x.code==='string'&&stamp(x.checkedAt));
}

// This operator can only model spot trades. It has no signer, swap API or funds.
export class MemeOperator {
 constructor(path,{clock=Date.now,feed,strategy='volume-breakout'}={}){
  if(!STRATEGIES.includes(strategy))throw new Error('Choose volume-breakout or trend-pullback.');
  this.clock=clock;
  // Ledger management must remain possible even with broken market configuration.
  this.feed=feed;
  mkdirSync(dirname(resolve(path)),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path);chmodSync(path,0o600);
  // Never silently reinterpret the former BTC outcome-contract ledger as tokens.
  if(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ghost_grok'").get()){
   this.db.close();throw new Error('Legacy BTC ledger detected. Use a new ghost-meme.sqlite path; legacy balances are not migrated.');
  }
  this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS ghost_meme (id INTEGER PRIMARY KEY, agent TEXT NOT NULL, payload TEXT NOT NULL, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0);');
  this.db.prepare('INSERT OR IGNORE INTO ghost_meme(id,agent,payload) VALUES(1,?,?)').run(AGENT_ID,JSON.stringify(initialState(strategy)));
  try{this.read();}catch(error){this.db.close();throw error;}
 }
 read(){
  const row=this.db.prepare('SELECT * FROM ghost_meme WHERE id=1').get();let s;
  try{s=JSON.parse(row?.payload);}catch{throw new Error('Invalid meme-coin simulation ledger.');}
  // Older v3 records did not retain the last complete mark. Their peak is a
  // conservative fallback; never migrate from an unknown cash-only valuation.
  if(record(s)&&!Object.hasOwn(s,'lastEquity'))s.lastEquity=s.peakEquity;
  if(row?.agent!==AGENT_ID||!validState(s))throw new Error('Invalid meme-coin simulation ledger.');
  return s;
 }
 status(){const s=this.read();return {agentId:AGENT_ID,marketKind:s.marketKind,chainId:8453,strategy:s.strategy,mode:'simulation',liveOrders:false,enabled:s.enabled,sessionUntil:s.sessionUntil,cash:s.cash,realized:s.realized,feesPaid:s.feesPaid,positions:s.positions,orders:s.orders,diagnostics:s.diagnostics,lastTick:s.lastTick,riskLock:s.riskLock};}
 async action(command){
  if(!['start','pause','tick'].includes(command))throw new Error('Only start, pause and tick are supported. No live orders.');
  const token=crypto.randomUUID(),at=this.clock();
  if(!Number.isSafeInteger(at)||at<=0)throw new Error('Invalid clock.');
  const claim=this.db.prepare('UPDATE ghost_meme SET lease_token=?,lease_until=? WHERE id=1 AND (lease_token IS NULL OR lease_until<=?)').run(token,at+120000,at);
  if(!claim.changes)throw new Error('Another worker owns the ledger.');
  try{
   const s=this.read();
   if(command!=='pause'&&at<s.lastTick)throw new Error('Invalid or regressed clock; ledger was not saved.');
   if(command==='start'){
    if(s.enabled&&s.sessionUntil>at)throw new Error('The active session cannot be extended.');
    if(s.riskLock)throw new Error('Risk lock requires review; start cannot reset it.');
    if(s.sessionUntil<=at){
     if(s.positions.length||s.orders.some(x=>x.status==='PENDING'))throw new Error('Resolve existing paper positions before a new session.');
     s.sessionUntil=at+PAPER_LIMITS.sessionMs;s.spent=0;
    }
    s.enabled=true;
   }
   if(command==='pause'){s.enabled=false;for(const o of s.orders)if(o.action==='BUY'&&o.status==='PENDING')o.status='CANCELLED';}
   if(command==='tick')await this.tick(s,at);
   assertFiniteState(s);
   if(!validState(s))throw new Error('Invalid meme-coin simulation ledger.');
   const saved=this.db.prepare('UPDATE ghost_meme SET payload=?,lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=? AND lease_until>?').run(JSON.stringify(s),token,this.clock());
   if(!saved.changes)throw new Error('Worker lease expired; results were not saved.');
   return this.status();
  }finally{this.db.prepare('UPDATE ghost_meme SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?').run(token);}
 }
 async tick(s,startedAt=this.clock()){
  let snapshots;
  try{
   this.feed??=createBaseMemeFeed({pools:(process.env.GHOST_BASE_POOLS||'').split(',').map(x=>x.trim()).filter(Boolean),now:this.clock});
   snapshots=await this.feed.snapshots();
  }catch{snapshots=[];}
  const at=this.clock();if(!stamp(at)||at===0||at<startedAt||at<s.lastTick)throw new Error('Invalid or regressed clock; ledger was not saved.');
  s.lastTick=at;s.diagnostics=[];
  if(at>=s.sessionUntil)s.enabled=false;
  if(!Array.isArray(snapshots)||snapshots.length>2)snapshots=[];
  const screened=[];
  for(const snapshot of snapshots){
   const result=screenMeme(snapshot,{now:at});
   s.diagnostics.push(result);
   if(result.status==='PASS')screened.push(snapshot);
  }
  const byKey=new Map(screened.map(x=>[key(x),x]));
  if(!snapshots.length)s.diagnostics.push(diagnostic('WAIT','MARKET_DATA_UNAVAILABLE',at,'Configure one or two Base pool addresses; provider errors never invent prices.'));
  // Unknown sale value does not release cash or erase an open position.
  let equity=s.cash,completeValuation=true;
  for(const p of s.positions){
   let snap=byKey.get(p.marketKey);
   if(snap&&!Number.isFinite(p.quantity*snap.priceUsd)){byKey.delete(p.marketKey);snap=null;}
   if(!snap){completeValuation=false;s.diagnostics.push(diagnostic('BLOCKED','POSITION_UNRESOLVED',at,'Fresh token-risk and market evidence is needed to model an exit.'));continue;}
   const value=Math.max(0,p.quantity*snap.priceUsd*sellFactor(taxes(snap).sell)-PAPER_LIMITS.gasUsd);
   if(!Number.isFinite(value)||!Number.isFinite(equity+value)){completeValuation=false;byKey.delete(p.marketKey);s.diagnostics.push(diagnostic('WAIT','VALUATION_INVALID',at,'Price arithmetic is outside supported numeric bounds.'));}else equity+=value;
  }
  if(completeValuation){
   if(s.day!==utcDay(at)){s.dayStartEquity=s.day===null?equity:Math.max(s.lastEquity,equity);s.day=utcDay(at);}
   s.peakEquity=Math.max(s.peakEquity,equity);
   if(s.dayStartEquity-equity>=PAPER_LIMITS.maxDailyLossUsd)s.riskLock='DAILY_LOSS_LIMIT';
   if(s.peakEquity-equity>=PAPER_LIMITS.maxDrawdownUsd)s.riskLock='DRAWDOWN_LIMIT';
  }
  if(s.riskLock){s.enabled=false;s.diagnostics.push(diagnostic('BLOCKED',s.riskLock,at,'New entries locked; modeled exits remain active.'));}
  let soldThisTick=false;
  for(const order of s.orders.filter(o=>o.status==='PENDING')){
   const snap=byKey.get(order.marketKey);
   if(order.action==='BUY'&&(!s.enabled||s.riskLock||at>=order.expiresAt)){order.status='CANCELLED';continue;}
   if(!snap||!fresh(snap.observedAt,at)||snap.observedAt<=order.observedAt||snap.observedAt<=order.createdAt||at<=order.createdAt)continue;
   const tax=taxes(snap);
   if(order.action==='BUY'){
    if(s.positions.length||!completeValuation||snap.priceUsd<=order.stop||snap.priceUsd>order.entry*1.02){order.status='CANCELLED';continue;}
    const lossPerUnit=snap.priceUsd*buyFactor(tax.buy)-order.stop*sellFactor(tax.sell);
    const quantity=Math.min(order.quantity,(equity*PAPER_LIMITS.riskPct/100-2*PAPER_LIMITS.gasUsd)/lossPerUnit,PAPER_LIMITS.maxPositionUsd/(snap.priceUsd*buyFactor(tax.buy)),(s.cash-2*PAPER_LIMITS.gasUsd)/(snap.priceUsd*buyFactor(tax.buy)));
    const cost=quantity*snap.priceUsd*buyFactor(tax.buy)+PAPER_LIMITS.gasUsd;
    if(!Number.isFinite(quantity)||quantity<=0||cost<1||cost>s.cash||s.spent+cost>PAPER_LIMITS.maxSessionSpend){order.status='CANCELLED';continue;}
    const targetProceeds=quantity*order.takeProfit*sellFactor(tax.sell)-PAPER_LIMITS.gasUsd;
    if(!Number.isFinite(targetProceeds)||targetProceeds<=cost){order.status='CANCELLED';s.diagnostics.push(diagnostic('WAIT','NET_TARGET_LOSS',at,'Modeled target proceeds do not cover entry and exit costs.'));continue;}
    s.cash-=cost;s.spent+=cost;s.feesPaid+=cost-quantity*snap.priceUsd;
    s.positions.push({marketKey:order.marketKey,tokenAddress:order.tokenAddress,poolAddress:order.poolAddress,quantity,cost,entry:snap.priceUsd,stop:order.stop,takeProfit:order.takeProfit,openedAt:at,strategy:s.strategy});
    Object.assign(order,{status:'FILLED',filledAt:at,fillPrice:snap.priceUsd,quantity});
   }else{
    const position=s.positions.find(p=>p.marketKey===order.marketKey);
    if(!position){order.status='CANCELLED';continue;}
    const gross=position.quantity*snap.priceUsd,proceeds=Math.max(0,gross*sellFactor(tax.sell)-PAPER_LIMITS.gasUsd);
    s.cash+=proceeds;s.realized+=proceeds-position.cost;s.feesPaid+=gross-proceeds;
    s.positions=s.positions.filter(p=>p!==position);soldThisTick=true;
    Object.assign(order,{status:'FILLED',filledAt:at,fillPrice:snap.priceUsd,quantity:position.quantity,realized:proceeds-position.cost});
   }
  }
  // A stop/target requests a sale; only a later independent quote models its fill.
  for(const p of s.positions){
   const snap=byKey.get(p.marketKey);
   if(!snap||p.openedAt===at||s.orders.some(o=>o.marketKey===p.marketKey&&o.status==='PENDING'&&o.action==='SELL'))continue;
   const reason=snap.priceUsd<=p.stop?'STOP_LOSS':snap.priceUsd>=p.takeProfit?'TAKE_PROFIT':s.riskLock?'RISK_EXIT':at>=s.sessionUntil?'SESSION_EXIT':null;
   if(reason)s.orders.push({id:crypto.randomUUID(),action:'SELL',side:'SPOT',status:'PENDING',marketKey:p.marketKey,tokenAddress:p.tokenAddress,poolAddress:p.poolAddress,createdAt:at,observedAt:snap.observedAt,exitReason:reason});
  }
  if(!soldThisTick&&s.enabled&&!s.riskLock&&completeValuation&&!s.positions.length&&!s.orders.some(o=>o.status==='PENDING')){
   for(const snap of screened){
    const result=evaluateMeme(snap,{strategy:s.strategy,now:at});s.diagnostics.push(result);
    if(result.status!=='PASS'||!result.plan)continue;
    const p=result.plan,signalKey=`${key(snap)}:${s.strategy}:${p.signalAt}`;
    if(s.entered.includes(signalKey)){s.diagnostics.push(diagnostic('WAIT','SIGNAL_ALREADY_USED',at,'This closed-candle signal was already evaluated for an order.'));continue;}
    const tax=taxes(snap),lossPerUnit=p.entry*buyFactor(tax.buy)-p.stop*sellFactor(tax.sell);
    const quantity=Math.min((equity*PAPER_LIMITS.riskPct/100-2*PAPER_LIMITS.gasUsd)/lossPerUnit,PAPER_LIMITS.maxPositionUsd/(p.entry*buyFactor(tax.buy)),(s.cash-2*PAPER_LIMITS.gasUsd)/(p.entry*buyFactor(tax.buy)));
    const cost=quantity*p.entry*buyFactor(tax.buy)+PAPER_LIMITS.gasUsd;
    if(!Number.isFinite(quantity)||quantity<=0||cost<1||cost>s.cash||s.spent+cost>PAPER_LIMITS.maxSessionSpend){s.diagnostics.push(diagnostic('WAIT','POSITION_BUDGET',at,'Estimated risk, costs or session budget reject the entry.'));continue;}
    const targetProceeds=quantity*p.takeProfit*sellFactor(tax.sell)-PAPER_LIMITS.gasUsd;
    if(!Number.isFinite(targetProceeds)||targetProceeds<=cost){s.diagnostics.push(diagnostic('WAIT','NET_TARGET_LOSS',at,'Modeled target proceeds do not cover entry and exit costs.'));continue;}
    s.orders.push({...p,id:crypto.randomUUID(),marketKey:key(snap),action:'BUY',side:'SPOT',status:'PENDING',quantity,createdAt:at,observedAt:snap.observedAt,expiresAt:at+PAPER_LIMITS.orderExpiryMs});
    s.entered.push(signalKey);break;
   }
  }
  s.orders=s.orders.filter(o=>o.status==='PENDING').concat(s.orders.filter(o=>o.status!=='PENDING').slice(-100));
  s.entered=s.entered.slice(-1000);
  // Preserve a complete post-fill mark across midnight and restarts. Missing
  // position evidence must not replace it with cash alone.
  let closingEquity=s.cash,complete=true;
  for(const p of s.positions){const snap=byKey.get(p.marketKey);
   if(!snap){complete=false;break;}closingEquity+=Math.max(0,p.quantity*snap.priceUsd*sellFactor(taxes(snap).sell)-PAPER_LIMITS.gasUsd);
  }
  if(complete&&Number.isFinite(closingEquity)){
   s.lastEquity=closingEquity;s.peakEquity=Math.max(s.peakEquity,closingEquity);
   if(s.dayStartEquity-closingEquity>=PAPER_LIMITS.maxDailyLossUsd)s.riskLock='DAILY_LOSS_LIMIT';
   if(s.peakEquity-closingEquity>=PAPER_LIMITS.maxDrawdownUsd)s.riskLock='DRAWDOWN_LIMIT';
   if(s.riskLock)s.enabled=false;
  }
 }
 close(){this.db.close();}
}

export async function main(args){
 const [command='status',path='./state/ghost-meme.sqlite',strategy='volume-breakout']=args;
 if(args.length>3||!['status','start','pause','tick','run'].includes(command))throw new Error('Use status, start, pause, tick or run [database] [volume-breakout|trend-pullback].');
 const operator=new MemeOperator(path,{strategy});let stopped=false;
 const stop=()=>{stopped=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{
  if(command==='status')return operator.status();
  if(command!=='run')return await operator.action(command);
  while(!stopped){
   const s=operator.read();if(!s.enabled&&!s.positions.length&&!s.orders.some(o=>o.status==='PENDING'))break;
   process.stdout.write(JSON.stringify(await operator.action('tick'))+'\n');
   if(!stopped)await new Promise(r=>setTimeout(r,15000));
  }
  return operator.status();
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);operator.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main(process.argv.slice(2)).then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(e=>{process.stderr.write(JSON.stringify({error:e.message})+'\n');process.exitCode=1;});
}
