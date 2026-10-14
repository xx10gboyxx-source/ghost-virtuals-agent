import {mapUSReads,usSlug} from './polymarket-us-feed.mjs';

// This price band is an experiment, not a forecast or a calibrated probability.
export const CRYPTO_DEFAULTS=Object.freeze({maxStake:5,maxExposure:20,maxPositions:3,maxOpenOrders:3,dailyLossLimit:10,maxSpend:50,entryMin:.55,entryMax:.85,takeProfitPct:15,stopLossPct:20,exitBeforeSeconds:45});
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
const up=n=>Math.ceil((n-1e-10)*100)/100;
const down=n=>Math.floor((n+1e-10)*100)/100;
const price=n=>Number.isFinite(n)&&n>0&&n<1;
const onTick=(p,t)=>price(p)&&Number.isFinite(t)&&t>0&&t<=.1&&Math.abs(p/t-Math.round(p/t))<=1e-6;
const sum=(rows,fn)=>money(rows.reduce((n,r)=>n+fn(r),0));
const pending=o=>['PENDING','PARTIAL','SUBMITTING','SUBMISSION_UNKNOWN'].includes(o.status);
export const cryptoActiveOrders=s=>s.orders.filter(pending);
export const cryptoReservedCash=s=>up(cryptoActiveOrders(s).filter(o=>o.action==='BUY').reduce((n,o)=>n+o.reserved,0));
export const cryptoCommittedRisk=s=>up(cryptoReservedCash(s)+s.positions.reduce((n,p)=>n+p.cost+p.fees,0));
const slots=s=>new Set([...s.positions.map(p=>p.slug),...cryptoActiveOrders(s).filter(o=>o.action==='BUY').map(o=>o.slug)]).size;
const lossTotal=(s,at)=>up(s.losses.filter(r=>r.at>at-86400000).reduce((n,r)=>n+r.amount,0));
export const cryptoFreshMarket=(m,at)=>Number.isFinite(m?.sourceAt)&&at-m.sourceAt<=15000&&m.sourceAt-at<=1000&&Number.isFinite(m.receivedAt)&&at-m.receivedAt<=15000&&m.receivedAt-at<=1000;
const windowValid=m=>m?.crypto15?.asset==='btc'&&m.crypto15.indexSymbol==='BRTI'&&Number.isFinite(m.crypto15.startAt)&&Number.isFinite(m.crypto15.endAt)&&m.crypto15.endAt-m.crypto15.startAt===900000&&Number.isFinite(m.crypto15.priceToBeat)&&m.crypto15.priceToBeat>0;
const feeValid=m=>Number.isFinite(m.feeCoefficient)&&m.feeCoefficient>=0&&m.feeCoefficient<=1;
const termsValid=m=>Number.isFinite(m.tickSize)&&m.tickSize>0&&m.tickSize<=.1&&Number.isFinite(m.minQuantity)&&m.minQuantity>0;
function bookValid(m){
 if(!termsValid(m))return false;
 for(const [key,no,descending] of [['yesDepth',false,false],['noDepth',true,false],['yesExitDepth',false,true],['noExitDepth',true,true]]){
  const levels=m[key];if(!Array.isArray(levels)||levels.length>500)return false;
  if(levels.some((l,i)=>!onTick(no?1-l.price:l.price,m.tickSize)||!Number.isFinite(l.quantity)||l.quantity<0||i>0&&(descending?l.price>=levels[i-1].price:l.price<=levels[i-1].price)))return false;
 }
 if(price(m.yesAsk)&&price(m.yesBid)&&m.yesBid>=m.yesAsk||price(m.noAsk)&&price(m.noBid)&&m.noBid>=m.noAsk)return false;
 return true;
}
export function initialCryptoState(mode='simulation'){
 if(!['simulation','live'].includes(mode))throw new Error('Unsupported crypto bot mode.');
 return {version:1,mode,enabled:false,sessionUntil:0,config:{...CRYPTO_DEFAULTS},cash:mode==='simulation'?100:0,fundsSnapshot:null,moneyPositionsAt:0,realized:0,feesPaid:0,spent:0,orders:[],positions:[],history:[],losses:[],completed:[],entered:[],diagnostics:[],lastTick:0,revision:0};
}
export function configureCrypto(s,patch,at=Date.now()){
 if(s.enabled)throw new Error('Pause new entries before changing crypto bot limits.');
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('Invalid crypto bot settings.');
 const config={...s.config};
 for(const [key,value] of Object.entries(patch)){
  if(!Object.hasOwn(CRYPTO_DEFAULTS,key))throw new Error('Unsupported crypto bot setting: '+key);
  let min=1,max=50,integer=false;
  if(['maxPositions','maxOpenOrders'].includes(key)){max=10;integer=true;}
  if(['entryMin','entryMax'].includes(key)){min=.05;max=.95;}
  if(['takeProfitPct','stopLossPct'].includes(key)){max=90;}
  if(key==='exitBeforeSeconds'){min=15;max=90;integer=true;}
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||integer&&!Number.isInteger(value))throw new Error('Invalid crypto bot limit: '+key+'.');
  config[key]=money(value);
 }
 if(config.entryMin>=config.entryMax)throw new Error('Entry minimum must be below entry maximum.');
 if(config.maxExposure<cryptoCommittedRisk(s)||config.dailyLossLimit<cryptoCommittedRisk(s)+lossTotal(s,at)||config.maxPositions<slots(s)||config.maxOpenOrders<cryptoActiveOrders(s).length||cryptoCommittedRisk(s)>0&&config.maxSpend<(s.spent||0)+cryptoReservedCash(s))throw new Error('New limits cannot fall below already committed risk or session spend.');
 s.config=config;return s;
}
export function startCrypto(s,at=Date.now()){
 // Restarting while any position/order exists cannot replenish the spend budget.
 if(!s.enabled&&!s.positions.length&&!cryptoActiveOrders(s).length)s.spent=0;
 s.enabled=true;s.sessionUntil=at+(s.mode==='simulation'?4:1)*3600000;return s;
}
function cancel(o,status,reason,at){o.status=status;o.reserved=0;o.reason=reason;o.updatedAt=at;}
export function pauseCrypto(s,at=Date.now()){
 s.enabled=false;s.sessionUntil=0;
 for(const o of cryptoActiveOrders(s).filter(o=>o.action==='BUY'))cancel(o,'CANCELLED','New entries paused; unfilled buy remainder cancelled.',at);
 return s;
}
export function explainCryptoEntry(s,m,at=Date.now()){
 const base={slug:m?.slug||'',title:m?.title||m?.slug||'BTC 15-minute discovery',checkedAt:at};
 const verdict=(status,code,reason,next,extra={})=>({...base,status,code,reason,next,...extra});
 if(!s.enabled||at>=s.sessionUntil)return verdict('WAIT','PAUSED','New entries are paused or the authorized session expired.','Explicitly start a new session; protective exits continue while the panel is active.');
 if(!m?.valid)return verdict('WAIT','DATA_UNAVAILABLE',m?.reason||'Verified US market data is unavailable.','Wait for the public feed to return verified BTC 15-minute markets.');
 if(!usSlug(m.slug)||!windowValid(m))return verdict('BLOCKED','UNVERIFIED_WINDOW','BTC/BRTI, the 15-minute window or its official price to beat is unverified.','Wait for a verified BTC 15-minute contract; titles alone are insufficient.');
 if(at<m.crypto15.startAt)return verdict('WAIT','WINDOW_NOT_STARTED','This contract’s measurement window has not started.','Wait until '+new Date(m.crypto15.startAt).toISOString()+'.');
 if(m.crypto15.endAt-at<=90000)return verdict('BLOCKED','ENTRY_CUTOFF','At most 90 seconds remain in the 15-minute window.','Wait for the next verified window.');
 if(cryptoActiveOrders(s).some(o=>o.slug===m.slug))return verdict('WAIT','PENDING_ORDER','An order for this window is still pending.','Wait for fill, cancellation or expiry; a submitted order is not a fill.');
 if(s.positions.some(p=>p.slug===m.slug))return verdict('WAIT','POSITION_OPEN','Filled contracts already occupy this window.','Monitor their protective exit or official settlement.');
 if((s.entered||[]).includes(m.slug)||s.completed.includes(m.slug))return verdict('BLOCKED','WINDOW_ALREADY_ENTERED','This window has already received a fill; repeat entry is disabled.','Wait for the next verified 15-minute window.');
 if(!m.active||!m.binary||!m.bookOpen||!Number.isFinite(m.closeAt)||m.closeAt<m.crypto15.endAt||m.closeAt-at<=90000)return verdict('BLOCKED','MARKET_UNAVAILABLE','The contract is not verified open for this full measurement window.','Wait for verified open market terms.');
 if(!cryptoFreshMarket(m,at))return verdict('WAIT','STALE_BOOK','The order book is missing a current timestamp, over 15 seconds old or in the future.','Receive a current book before admitting or filling orders.');
 if(!feeValid(m))return verdict('BLOCKED','UNKNOWN_FEES','The official market fee coefficient is unavailable.','Wait for verified fee metadata.');
 if(!termsValid(m)||!bookValid(m))return verdict('BLOCKED','INVALID_TERMS','The minimum size, tick increment or book depth is inconsistent.','Wait for consistent official terms and executable depth.');
 // Assess each side through every existing guard before ranking eligible sides.
 // A higher-priced but unaffordable side must not hide an eligible alternative.
 const checks=['YES','NO'].map(side=>{
 const limitPrice=side==='YES'?m.yesAsk:m.noAsk,depth=side==='YES'?m.yesDepth:m.noDepth;
 const result=(status,code,reason,next)=>({side,price:limitPrice,status,code,reason,next});
 if(!price(limitPrice)||limitPrice<s.config.entryMin||limitPrice>s.config.entryMax||!depth.some(l=>l.quantity>=1)||Math.abs(depth[0].price-limitPrice)>=1e-8)return result('WAIT','PRICE_BAND','No executable '+side+' offer is in the saved price band.','Wait for fresh executable depth inside the saved band.');
 const unitReserve=up(limitPrice)+up(m.feeCoefficient*limitPrice*(1-limitPrice));
 const maximumQuantity=Math.floor((s.config.maxStake+1e-9)/unitReserve),minimumQuantity=Math.ceil(m.minQuantity);
 if(maximumQuantity<minimumQuantity)return result('BLOCKED','STAKE_TOO_SMALL','The stake cannot fund the minimum whole-contract size and fees.','Wait for a contract whose minimum fits the saved stake.');
 if(cryptoActiveOrders(s).length>=s.config.maxOpenOrders)return result('WAIT','ORDER_LIMIT','Every pending-order slot is occupied.','Wait for a fill, cancellation or expiry.');
 if(slots(s)>=s.config.maxPositions)return result('WAIT','POSITION_LIMIT','Positions and pending buys occupy every position slot.','Wait for a full exit, settlement or pending-buy cancellation.');
 // maxStake is a ceiling, not a required spend. Round every remaining budget
 // down and retain conservative per-contract fees before sizing either side.
 const bounded=n=>Number.isFinite(n)?Math.max(0,down(n)):0,reserved=cryptoReservedCash(s),committed=cryptoCommittedRisk(s);
 const capacity={stake:bounded(s.config.maxStake),exposure:bounded(s.config.maxExposure-committed),loss:bounded(s.config.dailyLossLimit-lossTotal(s,at)-committed),spend:bounded(s.config.maxSpend-(s.spent||0)-reserved),cash:bounded(s.cash-reserved)};
 const budget=Math.min(...Object.values(capacity)),minimumReserve=up(minimumQuantity*unitReserve);
 if(capacity.exposure<minimumReserve-1e-8)return result('WAIT','EXPOSURE_LIMIT','Remaining exposure budget cannot fund the minimum size and fees.','Wait for committed risk to clear.');
 if(capacity.loss<minimumReserve-1e-8)return result('BLOCKED','LOSS_LIMIT','Remaining rolling loss budget cannot fund the minimum size and fees.','Wait for risk to clear and losses to leave the rolling 24-hour window.');
 if(capacity.spend<minimumReserve-1e-8)return result('BLOCKED','SPEND_LIMIT','Remaining session spend cannot fund the minimum size and fees.','Wait for open risk to clear, then explicitly start a new session.');
 if(capacity.cash<minimumReserve-1e-8)return result('WAIT','FUNDS','Available cash cannot fund the minimum size and fees after reservations.','Wait for a sale, settlement or reservation release.');
 const quantity=Math.min(maximumQuantity,Math.floor((budget+1e-9)/unitReserve)),reserve=up(quantity*unitReserve);
 const sizing={budget,capacity,maximumStake:s.config.maxStake,maximumQuantity,reduced:quantity<maximumQuantity,limitedBy:Object.keys(capacity).filter(key=>Math.abs(capacity[key]-budget)<1e-8)};
 const liquidity={quantityAtLimit:Math.floor(depth[0].quantity),requestedQuantity:quantity,sourceAt:m.sourceAt};
 return {...result('PASS','ELIGIBLE',side+' passed entry, funds and full-loss checks'+(sizing.reduced?' with a smaller order inside the remaining budgets.':'.'),'Eligible for an automatic bounded limit.'),quantity,reserve,unitReserve,feeCoefficient:m.feeCoefficient,sizing,liquidity};
 });
 const outcomeChecks=checks.map(({side,price,status,code,reason,next,quantity,reserve,sizing,liquidity})=>({side,price,status,code,reason,next,...(sizing?{quantity,reserve,sizing,liquidity}:{})}));
 const ranked=[...checks].sort((a,b)=>(b.price||0)-(a.price||0)),chosen=ranked.find(c=>c.status==='PASS');
 if(!chosen){const reason=ranked.find(c=>c.code!=='PRICE_BAND');return reason?verdict(reason.status,reason.code,reason.reason,reason.next,{outcomeChecks}):verdict('WAIT','PRICE_BAND','Neither executable outcome is in the saved experimental price band.','Wait for an offer in the saved band; implied price is not a guaranteed probability.',{outcomeChecks});}
 return {...base,...chosen,outcomeChecks,strategy:'grok_high_prob',reason:'Auto-selected '+chosen.side+' using the Grok price-band strategy: highest eligible offer after saved price, funds and risk checks; not a calibrated win probability.',next:s.mode==='live'?'Submit a bounded limit; wait for confirmed exchange fills and actual costs.':'Submit a bounded limit; only a later fresh book can produce a simulated fill.'};
}
export function cryptoExitPlan(p,m,config,at=Date.now()){
 if(!p||p.quantity<=0||!m?.valid||m.slug!==p.slug||!m.active||!m.binary||!m.bookOpen||!windowValid(m)||!cryptoFreshMarket(m,at)||!feeValid(m)||!bookValid(m)||!Number.isFinite(m.closeAt))return null;
 const endAt=p.crypto15?.endAt;
 if(!Number.isFinite(endAt)||endAt!==m.crypto15.endAt||at>=endAt||at>=m.closeAt)return null;
 const bid=p.side==='YES'?m.yesBid:m.noBid,depth=p.side==='YES'?m.yesExitDepth:m.noExitDepth;
 if(!price(bid)||!depth?.length||Math.abs(depth[0].price-bid)>1e-8||!onTick(p.side==='YES'?bid:1-bid,m.tickSize))return null;
 const basis=money(p.cost+p.fees),fees=up(p.quantity*m.feeCoefficient*bid*(1-bid));
 const estimatedNet=money(down(p.quantity*bid)-fees-basis),pct=basis>0?100*estimatedNet/basis:0;
 let reason=p.exitReason||null;
 if(endAt-at<=config.exitBeforeSeconds*1000)reason='WINDOW_EXIT';
 else if(!reason&&pct<=-config.stopLossPct)reason='STOP_LOSS';
 else if(!reason&&pct>=config.takeProfitPct)reason='TAKE_PROFIT';
 return reason?{reason,price:bid,quantity:p.quantity,estimatedNet,feeCoefficient:m.feeCoefficient,netReturnPct:pct}:null;
}
function submitBuy(s,m,d,at){
 const o={id:crypto.randomUUID(),slug:m.slug,title:m.title,action:'BUY',side:d.side,quantity:d.quantity,filled:0,limitPrice:d.price,reserved:d.reserve,unitReserve:d.unitReserve,cost:0,fees:0,feeCoefficient:m.feeCoefficient,status:'PENDING',createdAt:at,expiresAt:Math.min(at+30000,m.crypto15.endAt-90000),lastSourceAt:m.sourceAt,crypto15:{...m.crypto15},strategy:d.strategy,sizing:d.sizing,liquidity:d.liquidity,reason:'Buy limit submitted; no fill has occurred.'};s.orders.push(o);return o;
}
function submitSell(s,p,m,plan,at){
 p.exitReason=plan.reason;
 for(const o of cryptoActiveOrders(s).filter(o=>o.slug===p.slug&&o.action==='BUY'))cancel(o,'CANCELLED','Protective exit started; remaining entry cancelled.',at);
 if(cryptoActiveOrders(s).length>=s.config.maxOpenOrders)return null;
 const o={id:crypto.randomUUID(),positionId:p.id,slug:p.slug,title:p.title,action:'SELL',side:p.side,quantity:p.quantity,filled:0,limitPrice:plan.price,reserved:0,cost:0,fees:0,feeCoefficient:m.feeCoefficient,status:'PENDING',createdAt:at,expiresAt:Math.min(at+30000,p.crypto15.endAt),lastSourceAt:m.sourceAt,exitReason:plan.reason,reason:plan.reason+' sell limit submitted; no exit fill has occurred.'};s.orders.push(o);return o;
}
function recordExit(s,p,q,proceeds,exitFees,at,details){
 const all=q===p.quantity,cost=all?p.cost:money(p.cost*q/p.quantity),entryFees=all?p.fees:money(p.fees*q/p.quantity);
 const net=money(proceeds-exitFees-cost-entryFees);
 s.cash=money(s.cash+proceeds-exitFees);s.realized=money(s.realized+net);s.feesPaid=money(s.feesPaid+exitFees);
 s.history.push({positionId:p.id,slug:p.slug,title:p.title,side:p.side,quantity:q,cost,entryFees,exitFees,payout:proceeds,net,closedAt:at,...details});
 if(net<0)s.losses.push({at,amount:-net});
 p.quantity-=q;p.cost=money(p.cost-cost);p.fees=money(p.fees-entryFees);
 if(!p.quantity){s.positions=s.positions.filter(x=>x.id!==p.id);if(!s.completed.includes(p.slug))s.completed.push(p.slug);}
}
function fill(s,o,m,at){
 if(!m?.valid||!m.active||!m.binary||!m.bookOpen||!windowValid(m)||!cryptoFreshMarket(m,at)||!bookValid(m)||!Number.isFinite(m.closeAt)){o.reason='Waiting for verified fresh book data and trading terms.';return;}
 if(m.feeCoefficient!==o.feeCoefficient){cancel(o,'CANCELLED','Fee terms changed; a new review is required.',at);return;}
 const endAt=o.crypto15?.endAt??s.positions.find(p=>p.id===o.positionId)?.crypto15?.endAt;
 if(endAt!==m.crypto15.endAt||m.closeAt<endAt||at>=endAt||o.action==='BUY'&&(at>=s.sessionUntil||!s.enabled||endAt-at<=90000)){cancel(o,'CANCELLED','The saved entry window or session is no longer eligible.',at);return;}
 if(!onTick(o.side==='YES'?o.limitPrice:1-o.limitPrice,m.tickSize)){cancel(o,'CANCELLED','Saved limit no longer fits official price increments.',at);return;}
 if(m.sourceAt<=o.lastSourceAt){o.reason='Waiting for newer depth; displayed liquidity cannot fill twice.';return;}
 o.lastSourceAt=m.sourceAt;
 const levels=o.action==='BUY'?(o.side==='YES'?m.yesDepth:m.noDepth):(o.side==='YES'?m.yesExitDepth:m.noExitDepth);
 for(const level of levels){
  if(o.action==='BUY'?level.price>o.limitPrice+1e-9:level.price<o.limitPrice-1e-9)break;
  const p=o.action==='SELL'?s.positions.find(p=>p.id===o.positionId&&p.side===o.side&&p.slug===o.slug):null;
  const q=Math.min(Math.floor(level.quantity),o.quantity-o.filled,o.action==='SELL'?(p?.quantity||0):Infinity);if(q<=0)continue;
  const fees=up(q*o.feeCoefficient*level.price*(1-level.price));
  if(o.action==='BUY'){
   const cost=up(q*level.price),remaining=up((o.quantity-o.filled-q)*o.unitReserve);
   if(cost+fees+remaining>o.reserved+1e-8||cost+fees>s.cash+1e-8){cancel(o,'CANCELLED','The fill cannot be covered by its reserved funds.',at);break;}
   s.cash=money(s.cash-cost-fees);s.spent=money((s.spent||0)+cost+fees);s.feesPaid=money(s.feesPaid+fees);o.cost=money(o.cost+cost);o.reserved=remaining;
   let held=s.positions.find(p=>p.id===o.id);if(!held){held={id:o.id,slug:o.slug,title:o.title,side:o.side,quantity:0,cost:0,fees:0,openedAt:at,crypto15:{...o.crypto15}};s.positions.push(held);}
   held.quantity+=q;held.cost=money(held.cost+cost);held.fees=money(held.fees+fees);
   s.entered??=[];if(!s.entered.includes(o.slug))s.entered.push(o.slug);
  }else{
   const proceeds=down(q*level.price);recordExit(s,p,q,proceeds,fees,at,{reason:o.exitReason,source:'Polymarket US simulated book exit',orderId:o.id});o.cost=money(o.cost+proceeds);
  }
  o.filled+=q;o.fees=money(o.fees+fees);
  if(o.filled===o.quantity)break;
 }
 if(!pending(o))return;
 o.status=o.filled===o.quantity?'FILLED':o.filled?'PARTIAL':'PENDING';o.updatedAt=at;
 o.reason=o.status==='FILLED'?'Simulated '+o.action.toLowerCase()+' filled against later displayed depth.':o.status==='PARTIAL'?'Displayed depth supported only a partial fill.':'No later displayed whole-contract depth meets the saved limit.';
}
export async function runCryptoSimulation(s,feed,now=()=>Date.now()){
 if(s.mode!=='simulation')throw new Error('Simulation execution cannot access a live ledger.');
 const at=now();if(s.lastTick&&at-s.lastTick<5000)return s;
 if(s.enabled&&at>=s.sessionUntil)pauseCrypto(s,at);
 for(const o of cryptoActiveOrders(s))if(at>=o.expiresAt)cancel(o,'EXPIRED','Unfilled remainder expired; an exit may reprice after a fresh review.',at);
 const oldBuySlugs=new Set(cryptoActiveOrders(s).filter(o=>o.action==='BUY').map(o=>o.slug));
 // Open windows need executable exit books. Resolution reads cannot help until
 // the recorded measurement window ends, and otherwise delay every check.
 const ended=s.positions.filter(p=>Number.isFinite(p.crypto15?.endAt)&&at>=p.crypto15.endAt);
 const settlements=await mapUSReads([...new Set(ended.map(p=>p.slug))],async slug=>{try{const r=await feed.settlement(slug);return r?.slug===slug?r:null;}catch{return null;}});
 for(const r of settlements){
  if(!r?.resolved||!usSlug(r.slug)||!Number.isFinite(r.price)||r.price<0||r.price>1)continue;
  for(const p of s.positions.filter(p=>p.slug===r.slug))recordExit(s,p,p.quantity,down(p.quantity*(p.side==='YES'?r.price:1-r.price)),0,now(),{reason:'SETTLEMENT',settlementPrice:r.price,source:'Polymarket US official settlement'});
  for(const o of cryptoActiveOrders(s).filter(o=>o.slug===r.slug))cancel(o,'CANCELLED','Official settlement ended this market.',now());
 }
 let discovered=[],discoveryError='';
 try{const result=await feed.crypto15({includeUpcoming:false});discovered=Array.isArray(result)?result:result?.markets;discoveryError=result?.reason||'';if(!Array.isArray(discovered))throw new Error('Invalid market discovery response.');}
 catch(error){discovered=[];discoveryError=error.message||'BTC 15-minute discovery is unavailable.';}
 const wanted=[...new Set([...s.positions.map(p=>p.slug),...cryptoActiveOrders(s).map(o=>o.slug)])];
 let held=[];try{held=await feed.markets(wanted);}catch{held=[];}
 const bySlug=new Map(discovered.filter(m=>usSlug(m?.slug)).map(m=>[m.slug,m]));
 for(const m of held)if(wanted.includes(m?.slug))bySlug.set(m.slug,m);
 if(s.enabled&&now()>=s.sessionUntil)pauseCrypto(s,now());
 // Plan protective exits before processing buys so a partial position cannot
 // keep buying during its stop, take-profit or time exit.
 for(const p of [...s.positions]){
  const m=bySlug.get(p.slug),plan=cryptoExitPlan(p,m,s.config,now());
  if(plan){
   for(const o of cryptoActiveOrders(s).filter(o=>o.slug===p.slug&&o.action==='BUY'))cancel(o,'CANCELLED','Protective exit started; remaining entry cancelled.',now());
   if(!cryptoActiveOrders(s).some(o=>o.action==='SELL'&&o.positionId===p.id))submitSell(s,p,m,plan,now());
  }
 }
 for(const o of cryptoActiveOrders(s)){
  if(now()>=o.expiresAt)cancel(o,'EXPIRED','Unfilled remainder expired during the data request.',now());
  else fill(s,o,bySlug.get(o.slug),now());
 }
 // A buy that just filled also receives an exit review (submission only).
 for(const p of [...s.positions]){
  const m=bySlug.get(p.slug),plan=cryptoExitPlan(p,m,s.config,now());
  if(plan&&!cryptoActiveOrders(s).some(o=>o.action==='SELL'&&o.positionId===p.id))submitSell(s,p,m,plan,now());
 }
 s.diagnostics=[];
 // Reconcile fills and protective exits before admitting another entry.
 const candidates=[...new Map(discovered.filter(m=>usSlug(m?.slug)).map(m=>[m.slug,m])).values()].sort((a,b)=>a.slug.localeCompare(b.slug));
 const shift=candidates.length?Math.floor(at/5000)%candidates.length:0;
 for(const m of candidates.slice(shift).concat(candidates.slice(0,shift))){
  const d=explainCryptoEntry(s,bySlug.get(m.slug)||m,now());
  if(d.status==='PASS'&&!oldBuySlugs.has(m.slug)){const o=submitBuy(s,m,d,now());d.code='ORDER_SUBMITTED';d.reason=o.reason;d.next='Wait for a later fresh book within the limit and 30-second lifetime.';}
  s.diagnostics.push(d);
 }
 for(const p of s.positions){
  const order=cryptoActiveOrders(s).find(o=>o.action==='SELL'&&o.positionId===p.id),m=bySlug.get(p.slug);
  if(!order&&cryptoExitPlan(p,m,s.config,now())&&cryptoActiveOrders(s).length>=s.config.maxOpenOrders){s.diagnostics.push({slug:p.slug,title:p.title,checkedAt:now(),status:'WAIT',code:'ORDER_LIMIT',reason:'The saved open-order limit also applies to protective sells.',next:'Wait for a pending order to fill, cancel or expire.'});continue;}
  s.diagnostics.push({slug:p.slug,title:p.title,checkedAt:now(),status:'WAIT',code:order?'EXIT_PENDING':now()>=p.crypto15.endAt?'AWAITING_SETTLEMENT':!cryptoFreshMarket(m,now())?'EXIT_DATA_WAIT':'POSITION_MONITORING',reason:order?order.reason:now()>=p.crypto15.endAt?'The measurement window ended; held contracts await official settlement.':!cryptoFreshMarket(m,now())?'Fresh executable depth is unavailable; an exit cannot be assumed.':'Monitoring net take-profit, stop and pre-expiry exit conditions.',next:order?'Wait for later executable depth; unfilled exits can reprice after expiry.':now()>=p.crypto15.endAt?'Receive the verified official settlement.':'Keep the panel active for protective exit checks; stops are not guaranteed.'});
 }
 if(!candidates.length)s.diagnostics.push({slug:'',title:'BTC 15-minute discovery',checkedAt:now(),status:'WAIT',code:discoveryError?'DISCOVERY_UNAVAILABLE':'NO_MARKETS',reason:discoveryError||'No verified BTC 15-minute US market was returned.',next:'Retry when the next verified contract is listed; no substitute market is traded.'});
 s.lastTick=now();s.moneyPositionsAt=s.lastTick;s.losses=s.losses.filter(r=>r.at>s.lastTick-86400000);
 s.orders=[...s.orders.filter(o=>!pending(o)).slice(-100),...cryptoActiveOrders(s)];s.history=s.history.slice(-200);
 return s;
}
