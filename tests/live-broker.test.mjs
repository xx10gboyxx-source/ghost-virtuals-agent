import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData,keccak256,parseTransaction,recoverTransactionAddress} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {BASE_ADDRESSES as A,ERC20_ABI,ROUTER_ABI} from '../live/base-broker.mjs';
import {rpcFixture,TOKEN,POOL,OTHER,transfer} from './helpers/base-rpc.mjs';
const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code);
async function swap(h,side='BUY'){const input=h.input(side==='SELL'?{side,amountIn:'5000000000000000000'}:{});h.allowance=BigInt(input.amountIn);return h.broker.prepare(input);}
async function settled(h,options){const p=await swap(h);h.mine(p,options);return p;}

test('real signatures bind Base chain, exact approval, wallet, nonce, gas and zero native value',async()=>{
 const h=rpcFixture(),p=await h.broker.prepare(h.input()),tx=parseTransaction(p.rawTransaction);
 assert.equal(h.sent.length,0);assert.equal(p.kind,'APPROVE');assert.equal(tx.chainId,8453);assert.equal(tx.nonce??0,0);
 assert.equal(tx.to.toLowerCase(),A.usdc.toLowerCase());assert.equal(tx.value??0n,0n);assert.equal(tx.gas,120000n);
 assert.equal(tx.maxFeePerGas,10000000n);assert.equal(p.gasBudgetWei,'1200000022000');
 const call=decodeFunctionData({abi:ERC20_ABI,data:tx.data});assert.equal(call.functionName,'approve');assert.deepEqual(call.args,[A.router,10000000n]);
 assert.equal(await recoverTransactionAddress({serializedTransaction:p.rawTransaction}),h.account.address);assert.equal(keccak256(p.rawTransaction),p.hash);
});
test('non-exact existing allowances reset to zero, then exact approval, then swap',async()=>{
 const h=rpcFixture();h.allowance=(1n<<256n)-1n;
 for(const kind of ['APPROVAL_RESET','APPROVE','SWAP']){
  const p=await h.broker.prepare(h.input());assert.equal(p.kind,kind);h.mine(p);
  assert.equal((await h.broker.reconcile(p)).status,'CONFIRMED');
 }
 assert.equal(h.allowance,0n);assert.equal(h.signed.length,3);
});
test('swap calldata binds exact pool pair, recipient, minimum output and multicall deadline',async()=>{
 const h=rpcFixture(),p=await swap(h),outer=decodeFunctionData({abi:ROUTER_ABI,data:p.data});
 assert.equal(outer.functionName,'multicall');assert.equal(outer.args[0],BigInt(p.deadline));assert.equal(outer.args[1].length,1);
 const inner=decodeFunctionData({abi:ROUTER_ABI,data:outer.args[1][0]});assert.equal(inner.functionName,'exactInputSingle');
 assert.deepEqual(inner.args[0],{tokenIn:A.usdc,tokenOut:TOKEN,fee:3000,recipient:h.account.address,amountIn:10000000n,amountOutMinimum:4950000000000000000n,sqrtPriceLimitX96:0n});
});
test('both supported quote assets and SELL direction produce confirmed exact-input fills',async()=>{
 for(const quoteToken of [A.usdc,A.weth]){const h=rpcFixture({quoteToken}),p=await swap(h,'SELL');h.mine(p);
  const r=await h.broker.reconcile(p);assert.equal(r.status,'CONFIRMED');assert.equal(r.amountIn,'5000000000000000000');assert.equal(r.amountOut,(10n*10n**BigInt(h.quoteDecimals)).toString());}
});
for(const [name,mutate,code] of [
 ['wrong chain',h=>{h.client.getChainId=async()=>1;},'CHAIN_MISMATCH'],
 ['foreign factory',h=>{h.factory=OTHER;},'POOL_UNSUPPORTED'],
 ['noncanonical pool',h=>{h.mapping=OTHER;},'POOL_UNSUPPORTED'],
 ['unsupported quote',h=>{h.quoteToken=OTHER;},'QUOTE_UNSUPPORTED'],
 ['invalid token decimals',h=>{h.tokenDecimals=37;},'DECIMALS_UNSUPPORTED'],
 ['wrong USDC decimals',h=>{h.quoteDecimals=18;},'DECIMALS_UNSUPPORTED'],
 ['insufficient input balance',h=>{h.quote=1n;},'TOKEN_BALANCE_LOW'],
 ['gas estimate above limit',h=>{h.estimate=1000000n;},'GAS_LIMIT'],
 ['zero gas estimate',h=>{h.estimate=0n;},'GAS_LIMIT'],
 ['fee ceiling',h=>{h.fees.maxFeePerGas=10000000001n;},'FEE_LIMIT'],
 ['priority above max fee',h=>{h.fees.maxPriorityFeePerGas=20000000n;},'FEE_LIMIT'],
 ['L1 plus operator budget',h=>{h.l1=5000000000000n;},'GAS_BUDGET'],
 ['insufficient native balance',h=>{h.native=1n;},'GAS_BUDGET'],
 ['nonce already pending',h=>{h.pending.set('other',{});},'NONCE_BUSY'],
 ['nonce changed since quote block',h=>{h.client.getTransactionCount=async({blockNumber})=>blockNumber?0:1;},'NONCE_BUSY'],
 ['approval returned false',h=>{const sim=h.client.simulateContract;h.client.simulateContract=async x=>x.functionName==='approve'?{result:false}:sim(x);},'APPROVAL_REJECTED'],
 ['provider interruption',h=>{h.client.getBlock=async()=>{throw new Error('sensitive RPC detail');};},'RPC_OR_SIGNER_FAILURE']
])test(`prepare rejects ${name} before signing or submitting`,async()=>{const h=rpcFixture();mutate(h);await rejects(h.broker.prepare(h.input()),code);assert.equal(h.signed.length,0);assert.equal(h.sent.length,0);});
for(const [name,change,code] of [
 ['token not in pool',{tokenAddress:OTHER},'POOL_UNSUPPORTED'],
 ['quote used as meme token',{tokenAddress:A.usdc},'QUOTE_UNSUPPORTED'],
 ['zero amount',{amountIn:'0'},'AMOUNT_INVALID'],
 ['overflow amount',{amountIn:(1n<<256n).toString()},'AMOUNT_INVALID'],
 ['unbounded slippage',{slippageBps:101},'SLIPPAGE_INVALID'],
 ['unbounded impact',{maxPriceImpactBps:301},'IMPACT_INVALID'],
 ['expired deadline',{deadline:1},'DEADLINE_INVALID']
])test(`intent rejects ${name}`,async()=>{const h=rpcFixture();await rejects(h.broker.prepare(h.input(change)),code);assert.equal(h.signed.length,0);});
test('freshness, future references, distant deadlines and independent quote prices are enforced',async()=>{
 const h=rpcFixture();for(const observedAt of [h.at-90001,h.at+1])await rejects(h.broker.prepare(h.input({reference:{tokenPriceUsd:2,quotePriceUsd:1,observedAt}})),'REFERENCE_STALE');
 await rejects(h.broker.prepare(h.input({deadline:Math.floor(h.at/1000)+181})),'DEADLINE_INVALID');
 await rejects(h.broker.prepare(h.input({reference:{tokenPriceUsd:2,quotePriceUsd:1,observedAt:h.at,quoteTokenAddress:A.weth}})),'REFERENCE_IDENTITY_MISMATCH');
 for(const price of [1,3])await rejects(h.broker.prepare(h.input({reference:{tokenPriceUsd:price,quotePriceUsd:1,observedAt:h.at}})),'PRICE_REFERENCE_MISMATCH');
});
test('exact swap simulation cannot return less than the minimum',async()=>{const h=rpcFixture();h.simulatedOut=1n;await rejects(swap(h),'SIMULATION_INVALID');assert.equal(h.signed.length,0);});
test('malicious signer cannot change value, chain, destination, calldata, gas, nonce or wallet',async()=>{
 for(const change of [{value:1n},{chainId:1},{to:OTHER},{data:'0x'},{gas:1000001n},{nonce:9}]){
  const h=rpcFixture(),sign=h.account.signTransaction;h.account.signTransaction=tx=>sign({...tx,...change});await rejects(h.broker.prepare(h.input()),'PREPARED_INVALID');assert.equal(h.sent.length,0);
 }
 const h=rpcFixture(),other=privateKeyToAccount(keccak256('0x1234'));h.account.signTransaction=tx=>other.signTransaction(tx);await rejects(h.broker.prepare(h.input()),'PREPARED_INVALID');
});
test('persisted metadata tampering is rejected before broadcast',async()=>{
 const h=rpcFixture(),p=await swap(h);
 for(const change of [{hash:`0x${'0'.repeat(64)}`},{amountIn:'1'},{minOut:'1'},{from:OTHER},{to:OTHER},{deadline:p.deadline+1},{nonce:1},{gasBudgetWei:'1'},{token0:OTHER},{allowanceBefore:'0'}])await rejects(h.broker.broadcast({...p,...change}),'PREPARED_INVALID');
 assert.equal(h.sent.length,0);
});
test('broadcast retries submit exactly the same bytes/hash without another signature',async()=>{
 const h=rpcFixture(),p=await swap(h);assert.deepEqual(await h.broker.broadcast(p),{hash:p.hash});await h.broker.broadcast(p);
 assert.deepEqual(h.sent,[p.rawTransaction,p.rawTransaction]);assert.equal(h.signed.length,1);
});
test('broadcast rechecks pool, fees, balance and deadline',async()=>{
 for(const [change,code] of [[h=>{h.mapping=OTHER;},'POOL_UNSUPPORTED'],[h=>{h.l1=10n**18n;},'GAS_BUDGET'],[h=>{h.native=0n;},'GAS_BUDGET'],[h=>{h.at+=180000;},'DEADLINE_EXPIRED']]){
  const h=rpcFixture(),p=await swap(h);change(h);await rejects(h.broker.broadcast(p),code);assert.equal(h.sent.length,0);
 }
});
test('broadcast rejects nonce conflict and unknown pending replacement',async()=>{
 const h=rpcFixture(),p=await swap(h);h.nonce=1;await rejects(h.broker.broadcast(p),'NONCE_BUSY');h.nonce=0;h.pending.set('replacement',{});
 await assert.rejects(h.broker.broadcast(p));assert.equal(h.sent.length,0);
});
test('broadcast rejects malformed pending nonce rather than submitting',async()=>{
 const h=rpcFixture(),p=await swap(h);h.client.getTransactionCount=async({blockTag})=>blockTag==='pending'?NaN:0;
 await rejects(h.broker.broadcast(p),'NONCE_INVALID');assert.equal(h.sent.length,0);
});
test('receipt absent with consumed nonce is unresolved replacement, never a fill',async()=>{
 const h=rpcFixture(),p=await swap(h);h.nonce=1;const r=await h.broker.reconcile(p);assert.equal(r.status,'UNKNOWN');assert.equal(r.code,'NONCE_CONSUMED');
});
test('receipt needs two confirmations and a canonical block',async()=>{
 const h=rpcFixture(),p=await settled(h);h.head=h.block;assert.equal((await h.broker.reconcile(p)).status,'PENDING');h.head++;
 assert.equal((await h.broker.reconcile(p)).status,'CONFIRMED');h.receipts.get(p.hash).blockHash=`0x${'f'.repeat(64)}`;assert.equal((await h.broker.reconcile(p)).code,'RECEIPT_IDENTITY_MISMATCH');
});
test('receipt network interruption is redacted and unresolved',async()=>{
 const h=rpcFixture(),p=await swap(h);assert.equal((await h.broker.reconcile(p)).status,'PENDING');h.client.getTransactionReceipt=async()=>{throw new Error('private endpoint');};
 assert.deepEqual(await h.broker.reconcile(p),{status:'UNKNOWN',hash:p.hash,code:'RPC_OR_SIGNER_FAILURE'});
});
for(const [name,mutate,code] of [
 ['partial input',(h,p,r)=>{r.logs[0]=transfer(p.tokenIn,p.from,POOL,1n);},'TRANSFER_MISMATCH'],
 ['output below minimum',(h,p,r)=>{r.logs[1]=transfer(p.tokenOut,POOL,p.from,1n);},'TRANSFER_MISMATCH'],
 ['fee-on-transfer extra debit',(h,p,r)=>{r.logs.push(transfer(p.tokenOut,p.from,OTHER,1n));},'TRANSFER_MISMATCH'],
 ['wrong transfer recipient',(h,p,r)=>{r.logs[1]=transfer(p.tokenOut,POOL,OTHER,BigInt(p.quoteAmountOut));},'TRANSFER_MISMATCH'],
 ['missing swap event',(h,p,r)=>{r.logs.pop();},'SWAP_EVENT_MISMATCH'],
 ['unspent allowance',h=>{h.allowance=1n;},'TRANSFER_MISMATCH'],
 ['token wallet drift',h=>{h.token++;},'BALANCE_RECONCILIATION_MISMATCH'],
 ['native wallet drift',h=>{h.native++;},'BALANCE_RECONCILIATION_MISMATCH'],
 ['another wallet nonce',h=>{h.nonce++;},'EXTERNAL_ACCOUNT_ACTIVITY'],
 ['missing L1 receipt fee',(h,p,r)=>{delete r.l1Fee;},'L1_FEE_UNKNOWN'],
 ['wrong transaction hash',(h,p,r)=>{r.transactionHash=`0x${'a'.repeat(64)}`;},'RECEIPT_IDENTITY_MISMATCH'],
 ['excess gas usage',(h,p,r)=>{r.gasUsed=1000001n;},'RECEIPT_INVALID'],
 ['foreign mined transaction',(h,p)=>{h.transactions.get(p.hash).input='0x';},'RECEIPT_IDENTITY_MISMATCH']
])test(`reconciliation keeps ${name} unresolved`,async()=>{const h=rpcFixture(),p=await settled(h);mutate(h,p,h.receipts.get(p.hash));const r=await h.broker.reconcile(p);assert.equal(r.status,'UNKNOWN');assert.equal(r.code,code);});
test('approval requires exact owner/spender event, allowance and unchanged balances',async()=>{
 const h=rpcFixture(),p=await h.broker.prepare(h.input());const r=h.mine(p);assert.equal((await h.broker.reconcile(p)).status,'CONFIRMED');r.logs=[];
 assert.equal((await h.broker.reconcile(p)).code,'APPROVAL_EVENT_MISMATCH');
});
test('confirmed accounting includes L2 gas, L1 data fee and operator fee',async()=>{const h=rpcFixture(),p=await settled(h),r=await h.broker.reconcile(p);assert.equal(r.gasWei,'800000011000');assert.equal(r.amountIn,'10000000');assert.equal(r.amountOut,'5000000000000000000');});
for(const [name,change,code] of [
 ['quote transfer',h=>{h.quote++;},'BALANCE_RECONCILIATION_MISMATCH'],
 ['native transfer',h=>{h.native++;},'BALANCE_RECONCILIATION_MISMATCH'],
 ['external nonce',h=>{h.nonce++;},'EXTERNAL_ACCOUNT_ACTIVITY'],
 ['changed allowance',h=>{h.allowance++;},'APPROVAL_EVENT_MISMATCH']
])test(`reverted receipt with ${name} cannot clear the reservation`,async()=>{const h=rpcFixture(),p=await settled(h,{status:'reverted'});change(h);const r=await h.broker.reconcile(p);assert.equal(r.status,'UNKNOWN');assert.equal(r.code,code);});
test('reorg during reverted reconciliation cannot clear the reservation',async()=>{
 const h=rpcFixture(),p=await settled(h,{status:'reverted'}),get=h.client.getBlock;let calls=0;
 h.client.getBlock=async args=>{const b=await get(args);if(++calls===2)b.hash=`0x${'a'.repeat(64)}`;return b;};
 assert.equal((await h.broker.reconcile(p)).code,'REORG_DETECTED');
});
test('verified revert reports only gas and no token fill',async()=>{const h=rpcFixture(),p=await settled(h,{status:'reverted'}),r=await h.broker.reconcile(p);assert.equal(r.status,'REVERTED');assert.equal(r.amountIn,'0');assert.equal(r.amountOut,'0');assert.equal(r.gasWei,'800000011000');});
