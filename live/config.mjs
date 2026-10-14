import {STRATEGIES} from '../server/meme-strategy.mjs';

export const LIVE_DEFAULTS=Object.freeze({capitalUsd:50,maxPositionUsd:5,riskPct:0.5,
 maxSessionSpendUsd:50,maxDailyLossUsd:1.5,maxDrawdownUsd:5,slippageBps:100,
 maxPriceImpactBps:300,maxGasWei:'5000000000000',maxFeePerGasWei:'10000000000',sessionHours:4});
export const isAddress=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x)&&!/^0x0{40}$/i.test(x);
export const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
export function validateLiveConfig(input){
 const required=['mode','chainId','walletAddress','poolAddress','tokenAddress','strategy'];
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!required.includes(k)&&!Object.hasOwn(LIVE_DEFAULTS,k)))throw new Error('Invalid live configuration fields.');
 const c={...LIVE_DEFAULTS,...input};
 if(c.mode!=='live'||c.chainId!==8453||!STRATEGIES.includes(c.strategy)||!['walletAddress','poolAddress','tokenAddress'].every(k=>isAddress(c[k]))||c.poolAddress.toLowerCase()===c.tokenAddress.toLowerCase())throw new Error('Live configuration must specify Base, wallet, token, pool and strategy.');
 for(const k of ['walletAddress','poolAddress','tokenAddress'])c[k]=c[k].toLowerCase();
 for(const k of ['capitalUsd','maxPositionUsd','riskPct','maxSessionSpendUsd','maxDailyLossUsd','maxDrawdownUsd'])if(!positive(c[k]))throw new Error('Live monetary limits must be positive numbers.');
 if(c.capitalUsd>100000||c.maxPositionUsd>c.capitalUsd||c.maxSessionSpendUsd>c.capitalUsd*10||c.maxDailyLossUsd>c.capitalUsd||c.maxDrawdownUsd>c.capitalUsd||c.riskPct>2)throw new Error('Live limits are inconsistent or exceed the supported range.');
 if(!Number.isInteger(c.slippageBps)||c.slippageBps<1||c.slippageBps>100||!Number.isInteger(c.maxPriceImpactBps)||c.maxPriceImpactBps<1||c.maxPriceImpactBps>300||!Number.isInteger(c.sessionHours)||c.sessionHours<1||c.sessionHours>24)throw new Error('Use bounded slippage/impact and an entry session of one to 24 hours.');
 for(const k of ['maxGasWei','maxFeePerGasWei'])if(typeof c[k]!=='string'||!/^\d{1,24}$/.test(c[k])||BigInt(c[k])<=0n)throw new Error('Gas ceilings must be positive raw-wei strings.');
 if(BigInt(c.maxGasWei)>10000000000000000n||BigInt(c.maxFeePerGasWei)>100000000000n)throw new Error('Gas ceilings exceed supported limits.');
 return c;
}

// Convert a finite display amount to raw units by rounding downward, never up.
export function rawAmount(amount,decimals){
 if(!positive(amount)||!Number.isInteger(decimals)||decimals<0||decimals>36)throw new Error('Invalid token amount.');
 const [mantissa,exponent='0']=amount.toString().toLowerCase().split('e');
 const [whole,fraction='']=mantissa.split('.');
 const scale=decimals+Number(exponent)-fraction.length;
 const digits=BigInt(whole+fraction);
 return scale>=0?digits*10n**BigInt(scale):digits/10n**BigInt(-scale);
}
export const displayAmount=(raw,decimals)=>Number(BigInt(raw))/10**decimals;
