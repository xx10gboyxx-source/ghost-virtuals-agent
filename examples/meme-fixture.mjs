// Synthetic token and pool addresses. Never use this fixture for live decisions.
export const FIXTURE_TIME=Date.parse('2026-01-01T12:00:00Z');
export function memeFixture(now=FIXTURE_TIME){
 const end=Math.floor(now/300000)*300;
 const candles=Array.from({length:60},(_,i)=>{
  const close=0.001+i*0.000001;
  return {time:end-(60-i)*300,open:close-0.0000005,high:close+0.000001,low:close-0.000001,close,volume:1000};
 });
 const last=candles.at(-1),priorHigh=candles.at(-2).high;
 Object.assign(last,{open:priorHigh*0.998,high:priorHigh*1.014,low:priorHigh*0.996,close:priorHigh*1.01,volume:3000});
 const tokenAddress='0x1111111111111111111111111111111111111111';
 return {chainId:8453,tokenAddress,poolAddress:'0x2222222222222222222222222222222222222222',observedAt:now,priceUsd:last.close,liquidityUsd:250000,volume24hUsd:100000,poolCreatedAt:now-7*86400000,candles,security:{checkedAt:now,chainId:8453,tokenAddress,source:'goplus',top10HolderPct:20,flags:{is_open_source:'1',is_honeypot:'0',cannot_buy:'0',cannot_sell_all:'0',is_mintable:'0',is_proxy:'0',transfer_pausable:'0',slippage_modifiable:'0',owner_change_balance:'0',hidden_owner:'0',is_blacklisted:'0',personal_slippage_modifiable:'0',anti_whale_modifiable:'0',trading_cooldown:'0',can_take_back_ownership:'0',external_call:'0',selfdestruct:'0',is_whitelisted:'0',is_anti_whale:'0',buy_tax:'0',sell_tax:'0'}}};
}
