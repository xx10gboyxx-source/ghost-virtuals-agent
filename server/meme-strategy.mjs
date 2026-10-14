// Experimental research rules. PASS describes a paper signal, never authority to trade.
// All snapshot timestamps use milliseconds except candle.time (Unix seconds).
export const STRATEGIES=Object.freeze(['volume-breakout','trend-pullback']);

const BASE=8453;
const BAR_SECONDS=300;
const RISK_FLAGS=Object.freeze(['is_honeypot','cannot_buy','cannot_sell_all','is_mintable','is_proxy','transfer_pausable','slippage_modifiable','owner_change_balance','hidden_owner','is_blacklisted']);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const positive=value=>finite(value)&&value>0;
const timestamp=value=>Number.isSafeInteger(value)&&value>0;
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/i.test(value)&&!/^0x0{40}$/i.test(value);
const sameAddress=(a,b)=>address(a)&&address(b)&&a.toLowerCase()===b.toLowerCase();
const verdict=(status,code,reason,now,metrics={})=>({status,code,checkedAt:now,reason,metrics});
const tax=value=>typeof value==='string'&&/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value)?Number(value):NaN;

/** Verify supplied market/security evidence without technical entry conditions.
 * This is a local validator; it cannot authenticate the caller's claimed data source.
 * Missing evidence is WAIT. Known chain, contract or concentration risk is BLOCKED.
 */
export function screenMeme(snapshot,{now=Date.now()}={}){
  const metrics={};
  const result=(status,code,reason)=>verdict(status,code,reason,now,metrics);
  if(!timestamp(now))return result('WAIT','INVALID_CLOCK','A valid current timestamp is required.');
  if(!record(snapshot))return result('WAIT','INVALID_SNAPSHOT','A market snapshot is required.');
  if(!Number.isSafeInteger(snapshot.chainId))return result('WAIT','CHAIN_UNKNOWN','A numeric chain ID is required.');
  if(snapshot.chainId!==BASE)return result('BLOCKED','CHAIN_MISMATCH','This strategy supports Base chain 8453 only.');
  if(!address(snapshot.tokenAddress)||!address(snapshot.poolAddress)||sameAddress(snapshot.tokenAddress,snapshot.poolAddress))
    return result('WAIT','IDENTITY_INVALID','Distinct nonzero token and pool addresses are required.');
  if(!timestamp(snapshot.observedAt)||snapshot.observedAt>now||now-snapshot.observedAt>90000)
    return result('WAIT','QUOTE_STALE','The quote must be no more than 90 seconds old and cannot be future-dated.');
  if(!positive(snapshot.priceUsd)||!finite(snapshot.liquidityUsd)||snapshot.liquidityUsd<0||!finite(snapshot.volume24hUsd)||snapshot.volume24hUsd<0)
    return result('WAIT','MARKET_DATA_INVALID','Finite USD price, liquidity and volume are required.');
  Object.assign(metrics,{chainId:BASE,priceUsd:snapshot.priceUsd,liquidityUsd:snapshot.liquidityUsd,volume24hUsd:snapshot.volume24hUsd,quoteAgeMs:now-snapshot.observedAt});
  const security=snapshot.security;
  if(!record(security)||security.source!=='goplus')return result('WAIT','SECURITY_UNKNOWN','GoPlus security evidence is required.');
  if(!Number.isSafeInteger(security.chainId)||!address(security.tokenAddress))return result('WAIT','SECURITY_IDENTITY_UNKNOWN','Security evidence must identify its chain and token.');
  if(security.chainId!==BASE||!sameAddress(security.tokenAddress,snapshot.tokenAddress))return result('BLOCKED','SECURITY_IDENTITY_MISMATCH','Security evidence belongs to a different chain or token.');
  if(!timestamp(security.checkedAt)||security.checkedAt>now||now-security.checkedAt>300000)
    return result('WAIT','SECURITY_STALE','Security evidence must be no more than five minutes old and cannot be future-dated.');
  metrics.securityAgeMs=now-security.checkedAt;
  if(!record(security.flags))return result('WAIT','SECURITY_UNKNOWN','Explicit contract risk flags and tax evidence are required.');
  const flags=security.flags;
  // Check known unsafe values before unknown flags so a missing field cannot hide a risk.
  if(flags.is_open_source==='0'||RISK_FLAGS.some(key=>Object.hasOwn(flags,key)&&flags[key]==='1'))
    return result('BLOCKED','CONTRACT_RISK','Security evidence reports an unsupported contract risk.');
  const buyTax=Object.hasOwn(flags,'buy_tax')?tax(flags.buy_tax):NaN;
  const sellTax=Object.hasOwn(flags,'sell_tax')?tax(flags.sell_tax):NaN;
  if((finite(buyTax)&&buyTax>.05)||(finite(sellTax)&&sellTax>.05))return result('BLOCKED','TAX_LIMIT','Reported buy or sell tax exceeds the experimental 5% limit.');
  if(finite(security.top10HolderPct)&&security.top10HolderPct>=0&&security.top10HolderPct<=100&&security.top10HolderPct>30)
    return result('BLOCKED','CONCENTRATION_LIMIT','Reported top-ten holder concentration exceeds the experimental 30% limit.');
  if(!Object.hasOwn(flags,'is_open_source')||flags.is_open_source!=='1'||RISK_FLAGS.some(key=>!Object.hasOwn(flags,key)||flags[key]!=='0'))
    return result('WAIT','SECURITY_UNKNOWN','Every required contract risk flag must have an explicit supported value.');
  if(!finite(buyTax)||!finite(sellTax))return result('WAIT','TAX_UNKNOWN','Buy and sell taxes must be decimal strings from zero to one.');
  if(!finite(security.top10HolderPct)||security.top10HolderPct<0||security.top10HolderPct>100)
    return result('WAIT','CONCENTRATION_UNKNOWN','A valid top-ten holder percentage is required.');
  Object.assign(metrics,{buyTax,sellTax,top10HolderPct:security.top10HolderPct});
  if(!timestamp(snapshot.poolCreatedAt)||snapshot.poolCreatedAt>now)return result('WAIT','POOL_AGE_UNKNOWN','A valid past pool creation timestamp is required.');
  metrics.poolAgeHours=(now-snapshot.poolCreatedAt)/3600000;
  if(metrics.poolAgeHours<48)return result('WAIT','POOL_TOO_NEW','Pool age must reach the experimental 48-hour minimum.');
  if(snapshot.liquidityUsd<100000)return result('WAIT','LIQUIDITY_LIMIT','Reported liquidity must reach the experimental $100,000 minimum.');
  if(snapshot.volume24hUsd<50000)return result('WAIT','VOLUME_LIMIT','Reported daily volume must reach the experimental $50,000 minimum.');
  return result('PASS','SCREEN_PASSED','Supplied market and security evidence meets the experimental screening rules.');
}

function closedCandles(input,now){
  if(!Array.isArray(input)||input.length<60||input.length>10000)return null;
  const currentStart=Math.floor(now/(BAR_SECONDS*1000))*BAR_SECONDS;
  for(let i=0;i<input.length;i++){
    const candle=input[i];
    if(!record(candle)||!Number.isSafeInteger(candle.time)||candle.time<=0||candle.time%BAR_SECONDS!==0||candle.time>currentStart||
       !positive(candle.open)||!positive(candle.high)||!positive(candle.low)||!positive(candle.close)||!finite(candle.volume)||candle.volume<0||
       candle.high<Math.max(candle.open,candle.close)||candle.low>Math.min(candle.open,candle.close)||
       (i>0&&candle.time-input[i-1].time!==BAR_SECONDS))return null;
  }
  const candles=input.at(-1).time===currentStart?input.slice(0,-1):input.slice();
  if(candles.length<60||candles.at(-1).time!==currentStart-BAR_SECONDS)return null;
  return candles;
}

function ema(values,period){
  let value=values.slice(0,period).reduce((sum,x)=>sum+x,0)/period;
  const weight=2/(period+1);
  for(let i=period;i<values.length;i++)value=values[i]*weight+value*(1-weight);
  return value;
}

function atr(candles,period){
  const ranges=candles.map((c,i)=>i===0?c.high-c.low:Math.max(c.high-c.low,Math.abs(c.high-candles[i-1].close),Math.abs(c.low-candles[i-1].close)));
  let value=ranges.slice(0,period).reduce((sum,x)=>sum+x,0)/period;
  for(let i=period;i<ranges.length;i++)value=(value*(period-1)+ranges[i])/period;
  return value;
}

function rsi(values,period){
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){
    const delta=values[i]-values[i-1];gain+=Math.max(delta,0)/period;loss+=Math.max(-delta,0)/period;
  }
  for(let i=period+1;i<values.length;i++){
    const delta=values[i]-values[i-1];gain=(gain*(period-1)+Math.max(delta,0))/period;loss=(loss*(period-1)+Math.max(-delta,0))/period;
  }
  return loss===0?(gain===0?50:100):100-100/(1+gain/loss);
}

/** Produce one deterministic paper signal from closed five-minute Base candles. */
export function evaluateMeme(snapshot,{strategy='volume-breakout',now=Date.now()}={}){
  const screen=screenMeme(snapshot,{now});
  const result=(status,code,reason,metrics=screen.metrics,plan=null)=>({...verdict(status,code,reason,now,metrics),plan});
  if(screen.status!=='PASS')return {...screen,plan:null};
  if(!STRATEGIES.includes(strategy))return result('WAIT','STRATEGY_UNKNOWN','Choose volume-breakout or trend-pullback.');
  const candles=closedCandles(snapshot.candles,now);
  if(!candles)return result('WAIT','CANDLES_INVALID','At least 60 valid, aligned, contiguous closed five-minute candles ending at the latest close are required.');
  const latest=candles.at(-1),previous=candles.at(-2),closes=candles.map(c=>c.close),prior=candles.slice(-21,-1);
  const meanVolume=prior.reduce((sum,c)=>sum+c.volume,0)/20;
  const metrics={...screen.metrics,closedCandles:candles.length,ema20:ema(closes,20),ema50:ema(closes,50),atr14:atr(candles,14),rsi14:rsi(closes,14),volumeRatio:meanVolume>0?latest.volume/meanVolume:null,breakoutLevel:Math.max(...prior.map(c=>c.high))};
  metrics.chasePct=(latest.close/metrics.breakoutLevel-1)*100;
  if(![metrics.ema20,metrics.ema50,metrics.atr14,metrics.rsi14,metrics.breakoutLevel,metrics.chasePct].every(finite)||!positive(meanVolume)||!finite(metrics.volumeRatio))
    return result('WAIT','INDICATORS_INVALID','Indicator calculations require finite values and nonzero prior volume.',metrics);
  if(snapshot.priceUsd>latest.close*1.03||snapshot.priceUsd<latest.close*.97)return result('WAIT','QUOTE_CANDLE_MISMATCH','Current quote differs by more than 3% from the latest closed candle.',metrics);
  if(metrics.ema20<=metrics.ema50)return result('WAIT','TREND_NOT_READY','The 20-period EMA must be above the 50-period EMA.',metrics);
  if(strategy==='volume-breakout'){
    if(latest.close<=metrics.breakoutLevel)return result('WAIT','BREAKOUT_NOT_READY','The latest close has not exceeded the preceding 20-candle high.',metrics);
    if(latest.close>metrics.breakoutLevel*1.03)return result('WAIT','CHASE_LIMIT','Price is more than 3% above the breakout level.',metrics);
    if(metrics.volumeRatio<2)return result('WAIT','BREAKOUT_VOLUME','Breakout volume must be at least twice the prior 20-candle mean.',metrics);
  }else{
    if(latest.close<=latest.open||latest.close<=previous.close||latest.close<=metrics.ema20||latest.close>metrics.ema20*1.02||latest.low>metrics.ema20*1.01||latest.low<metrics.ema20*.97)
      return result('WAIT','PULLBACK_NOT_READY','A bullish recovery near the 20-period EMA is required.',metrics);
    if(metrics.rsi14<45||metrics.rsi14>68)return result('WAIT','RSI_LIMIT','Pullback RSI must be between 45 and 68.',metrics);
    if(metrics.volumeRatio<1.2)return result('WAIT','PULLBACK_VOLUME','Recovery volume must be at least 1.2 times the prior 20-candle mean.',metrics);
  }
  const entry=latest.close,risk=Math.max(2*metrics.atr14,.03*entry);
  if(!positive(risk)||risk>.1*entry)return result('WAIT','VOLATILITY_LIMIT','The proposed stop distance exceeds 10% of entry.',metrics);
  const plan={tokenAddress:snapshot.tokenAddress,poolAddress:snapshot.poolAddress,strategy,entry,stop:entry-risk,takeProfit:entry+2*risk,signalAt:(latest.time+BAR_SECONDS)*1000};
  if(!positive(plan.stop)||!positive(plan.takeProfit))return result('WAIT','PLAN_INVALID','Finite positive plan prices are required.',metrics);
  return result('PASS','PAPER_SIGNAL','Experimental closed-candle signal passed. The plan is for simulation only.',metrics,plan);
}
