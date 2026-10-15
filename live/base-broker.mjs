import {createPublicClient,createWalletClient,http,parseAbi,encodeFunctionData,decodeFunctionData,decodeFunctionResult,decodeEventLog,parseTransaction,recoverTransactionAddress,serializeTransaction,keccak256,getAddress} from 'viem';
import {base} from 'viem/chains';

export const BASE_CHAIN_ID=8453;
export const BASE_ADDRESSES=Object.freeze({factory:'0x33128a8fC17869897dcE68Ed026d694621f6FDfD',quoter:'0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',router:'0x2626664c2603336E57B271c5C0b26F421741e481',weth:'0x4200000000000000000000000000000000000006',usdc:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',gasOracle:'0x420000000000000000000000000000000000000F'});
export const ERC20_ABI=parseAbi(['function decimals() view returns (uint8)','function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)','function approve(address spender,uint256 amount) returns (bool)','event Transfer(address indexed from,address indexed to,uint256 value)','event Approval(address indexed owner,address indexed spender,uint256 value)']);
export const FACTORY_ABI=parseAbi(['function getPool(address,address,uint24) view returns (address)']);
export const POOL_ABI=parseAbi(['function factory() view returns (address)','function token0() view returns (address)','function token1() view returns (address)','function fee() view returns (uint24)','event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)']);
export const ROUTER_ABI=parseAbi(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)','function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)']);
export const QUOTER_ABI=parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);
export const GAS_ORACLE_ABI=parseAbi(['function getL1Fee(bytes) view returns (uint256)','function getOperatorFee(uint256) view returns (uint256)']);
const UINT256=(1n<<256n)-1n,ZERO='0x0000000000000000000000000000000000000000';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
class BrokerError extends Error{constructor(code){super(`Base broker blocked: ${code}.`);this.code=code;}}
const fail=code=>{throw new BrokerError(code);};
const redacted=e=>e instanceof BrokerError?e:new BrokerError('RPC_OR_SIGNER_FAILURE');
const addr=x=>{try{const a=getAddress(x);if(same(a,ZERO))fail('ADDRESS_INVALID');return a;}catch{fail('ADDRESS_INVALID');}};
function amount(x,{zero=false}={}){if(typeof x!=='string'||x.length>78||!(/^(0|[1-9]\d*)$/).test(x))fail('AMOUNT_INVALID');const n=BigInt(x);if(n>UINT256||(!zero&&n===0n))fail('AMOUNT_INVALID');return n;}
function integer(x,min,max,code){if(!Number.isSafeInteger(x)||x<min||x>max)fail(code);return x;}
const safeBig=x=>{if(typeof x!=='bigint'||x<0n)fail('RPC_DATA_INVALID');return x;};
function priceFraction(x){
 if(typeof x!=='number'||!Number.isFinite(x)||x<=0)fail('REFERENCE_INVALID');
 const [digits,exponent='0']=x.toString().toLowerCase().split('e'),[whole,fraction='']=digits.split('.');
 const scale=fraction.length-Number(exponent),n=BigInt(whole+fraction);
 return scale>=0?[n,10n**BigInt(scale)]:[n*10n**BigInt(-scale),1n];
}
function canonicalIntent(input,now,{expired=false}={}){
 if(!object(input)||!['BUY','SELL'].includes(input.side)||!object(input.reference))fail('INTENT_INVALID');
 const poolAddress=addr(input.poolAddress),tokenAddress=addr(input.tokenAddress);if(same(poolAddress,tokenAddress))fail('INTENT_INVALID');
 amount(input.amountIn);integer(input.slippageBps,1,100,'SLIPPAGE_INVALID');integer(input.maxPriceImpactBps,1,300,'IMPACT_INVALID');
 integer(input.deadline,1,Number.MAX_SAFE_INTEGER,'DEADLINE_INVALID');
 if(!expired&&(input.deadline*1000<=now+10000||input.deadline*1000>now+180000))fail('DEADLINE_INVALID');
 priceFraction(input.reference.tokenPriceUsd);priceFraction(input.reference.quotePriceUsd);
 integer(input.reference.observedAt,1,Number.MAX_SAFE_INTEGER,'REFERENCE_STALE');
 if(!expired&&(input.reference.observedAt>now||now-input.reference.observedAt>90000))fail('REFERENCE_STALE');
 const reference={tokenPriceUsd:input.reference.tokenPriceUsd,quotePriceUsd:input.reference.quotePriceUsd,observedAt:input.reference.observedAt};
 if(input.reference.quoteTokenAddress!==undefined)reference.quoteTokenAddress=addr(input.reference.quoteTokenAddress);
 return {poolAddress,tokenAddress,side:input.side,amountIn:input.amountIn,slippageBps:input.slippageBps,maxPriceImpactBps:input.maxPriceImpactBps,reference,deadline:input.deadline};
}
const json=x=>JSON.parse(JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v));
function swapData(intent){
 const call=encodeFunctionData({abi:ROUTER_ABI,functionName:'exactInputSingle',args:[{tokenIn:intent.tokenIn,tokenOut:intent.tokenOut,fee:intent.fee,recipient:intent.from,amountIn:amount(intent.amountIn),amountOutMinimum:amount(intent.minOut),sqrtPriceLimitX96:0n}]});
 return encodeFunctionData({abi:ROUTER_ABI,functionName:'multicall',args:[BigInt(intent.deadline),[call]]});
}
const approvalData=(kind,input)=>encodeFunctionData({abi:ERC20_ABI,functionName:'approve',args:[BASE_ADDRESSES.router,kind==='APPROVAL_RESET'?0n:amount(input.amountIn)]});

/** One EOA, one canonical Uniswap v3 pool, ERC20 exact-input swaps only.
 * prepare signs but never broadcasts. The caller must durably persist its return
 * before broadcast and keep the nonce locked until reconciliation is conclusive.
 */
export class BaseSwapBroker{
 constructor({rpcUrl,account,clock=Date.now,publicClient,walletClient,maxGasWei='100000000000000',maxFeePerGasWei='10000000000'}={}){
  this.address=addr(typeof account==='string'?account:account?.address);this.account=account;this.clock=clock;
  this.maxGasWei=amount(String(maxGasWei));this.maxFeePerGasWei=amount(String(maxFeePerGasWei));
  if(typeof clock!=='function')fail('CLOCK_INVALID');
  if(!publicClient||!walletClient){
   let u;try{u=new URL(rpcUrl);}catch{if(!publicClient)fail('RPC_URL_INVALID');}
   if(u&&!((u.protocol==='https:'&&!u.username&&!u.password)||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&!u.username&&!u.password)))fail('RPC_URL_INVALID');
   if(!publicClient)publicClient=createPublicClient({chain:base,transport:http(rpcUrl,{timeout:8000,retryCount:0})});
   if(!walletClient&&u)walletClient=createWalletClient({chain:base,account,transport:http(rpcUrl,{timeout:8000,retryCount:0})});
  }
  this.publicClient=publicClient;this.walletClient=walletClient??publicClient;
 }
 now(){const at=this.clock();return integer(at,1,Number.MAX_SAFE_INTEGER,'CLOCK_INVALID');}
 async chain(){if(await this.publicClient.getChainId()!==BASE_CHAIN_ID)fail('CHAIN_MISMATCH');}
 async read(address,abi,functionName,args=[],blockNumber){return this.publicClient.readContract({address,abi,functionName,args,...(blockNumber===undefined?{}:{blockNumber})});}
 async market({poolAddress,tokenAddress}){
  await this.chain();poolAddress=addr(poolAddress);tokenAddress=addr(tokenAddress);
  const block=await this.publicClient.getBlock({blockTag:'latest'});if(typeof block.number!=='bigint'||typeof block.hash!=='string')fail('RPC_DATA_INVALID');
  const b=block.number;
  const [factory,t0,t1,fee]=await Promise.all(['factory','token0','token1','fee'].map(f=>this.read(poolAddress,POOL_ABI,f,[],b)));
  const token0=addr(t0),token1=addr(t1);integer(fee,1,10000,'POOL_UNSUPPORTED');
  if(!same(factory,BASE_ADDRESSES.factory)||same(token0,token1)||(!same(tokenAddress,token0)&&!same(tokenAddress,token1)))fail('POOL_UNSUPPORTED');
  const quoteToken=same(tokenAddress,token0)?token1:token0;
  if(![BASE_ADDRESSES.usdc,BASE_ADDRESSES.weth].some(q=>same(q,quoteToken))||[BASE_ADDRESSES.usdc,BASE_ADDRESSES.weth].some(q=>same(q,tokenAddress)))fail('QUOTE_UNSUPPORTED');
  const [mapping,td,qd,tb,qb,native]=await Promise.all([
   this.read(BASE_ADDRESSES.factory,FACTORY_ABI,'getPool',[token0,token1,fee],b),
   this.read(tokenAddress,ERC20_ABI,'decimals',[],b),this.read(quoteToken,ERC20_ABI,'decimals',[],b),
   this.read(tokenAddress,ERC20_ABI,'balanceOf',[this.address],b),this.read(quoteToken,ERC20_ABI,'balanceOf',[this.address],b),
   this.publicClient.getBalance({address:this.address,blockNumber:b})]);
  if(!same(mapping,poolAddress))fail('POOL_UNSUPPORTED');
  integer(td,0,36,'DECIMALS_UNSUPPORTED');integer(qd,0,36,'DECIMALS_UNSUPPORTED');
  if(qd!==(same(quoteToken,BASE_ADDRESSES.usdc)?6:18))fail('DECIMALS_UNSUPPORTED');
  return {poolAddress,tokenAddress,token0,token1,quoteToken,tokenDecimals:td,quoteDecimals:qd,fee,tokenBalance:safeBig(tb).toString(),quoteBalance:safeBig(qb).toString(),nativeBalance:safeBig(native).toString(),blockNumber:b.toString(),blockHash:block.hash};
 }
 async inspect(input){try{return await this.market(input);}catch(e){throw redacted(e);}}
 async quote(input){try{
  const intent=canonicalIntent(input,this.now()),m=await this.market(intent),buy=intent.side==='BUY';
  if(intent.reference.quoteTokenAddress&&!same(intent.reference.quoteTokenAddress,m.quoteToken))fail('REFERENCE_IDENTITY_MISMATCH');
  const tokenIn=buy?m.quoteToken:m.tokenAddress,tokenOut=buy?m.tokenAddress:m.quoteToken,inputAmount=amount(intent.amountIn);
  if(inputAmount>amount(buy?m.quoteBalance:m.tokenBalance,{zero:true}))fail('TOKEN_BALANCE_LOW');
  const quoted=await this.publicClient.simulateContract({address:BASE_ADDRESSES.quoter,abi:QUOTER_ABI,functionName:'quoteExactInputSingle',args:[{tokenIn,tokenOut,amountIn:inputAmount,fee:m.fee,sqrtPriceLimitX96:0n}],account:this.address,blockNumber:BigInt(m.blockNumber)});
  const out=quoted?.result?.[0];if(typeof out!=='bigint'||out<=0n||out>UINT256)fail('QUOTE_INVALID');
  const [inN,inD]=priceFraction(buy?intent.reference.quotePriceUsd:intent.reference.tokenPriceUsd),[outN,outD]=priceFraction(buy?intent.reference.tokenPriceUsd:intent.reference.quotePriceUsd);
  const inDecimals=buy?m.quoteDecimals:m.tokenDecimals,outDecimals=buy?m.tokenDecimals:m.quoteDecimals;
  // Compare exact rational USD values. Reject both adverse execution and an
  // implausibly favorable quote, which usually indicates an identity/unit error.
  const actual=out*outN*inD*10n**BigInt(inDecimals),expected=inputAmount*inN*outD*10n**BigInt(outDecimals),limit=BigInt(intent.maxPriceImpactBps);
  if(actual*10000n<expected*(10000n-limit)||actual*10000n>expected*(10000n+limit))fail('PRICE_REFERENCE_MISMATCH');
  const minOut=out*BigInt(10000-intent.slippageBps)/10000n;if(minOut<=0n)fail('MIN_OUT_ZERO');
  canonicalIntent(intent,this.now());
  return {...intent,...m,tokenIn,tokenOut,quoteAmountOut:out.toString(),minOut:minOut.toString(),quotedAt:this.now()};
 }catch(e){throw redacted(e);}}
 async prepare(input){try{
  if(typeof this.account?.signTransaction!=='function')fail('LOCAL_SIGNER_REQUIRED');
  const q=await this.quote(input),allowance=safeBig(await this.read(q.tokenIn,ERC20_ABI,'allowance',[this.address,BASE_ADDRESSES.router])),n=amount(q.amountIn);
  const kind=allowance===n?'SWAP':allowance>0n?'APPROVAL_RESET':'APPROVE',to=kind==='SWAP'?BASE_ADDRESSES.router:q.tokenIn;
  const record={...q,kind,from:this.address,to,chainId:BASE_CHAIN_ID,allowanceBefore:allowance.toString()};
  const data=kind==='SWAP'?swapData(record):approvalData(kind,record);
  const [latest,pending,observedNonce]=await Promise.all([...['latest','pending'].map(blockTag=>this.publicClient.getTransactionCount({address:this.address,blockTag})),this.publicClient.getTransactionCount({address:this.address,blockNumber:BigInt(q.blockNumber)})]);
  integer(latest,0,Number.MAX_SAFE_INTEGER,'NONCE_INVALID');if(pending!==latest||observedNonce!==latest)fail('NONCE_BUSY');
  const sim=await this.publicClient.simulateContract(kind==='SWAP'?{address:to,abi:ROUTER_ABI,functionName:'multicall',args:[BigInt(q.deadline),decodeFunctionData({abi:ROUTER_ABI,data}).args[1]],account:this.address,value:0n}:{address:to,abi:ERC20_ABI,functionName:'approve',args:[BASE_ADDRESSES.router,kind==='APPROVAL_RESET'?0n:n],account:this.address});
  if(kind==='SWAP'){
   const simulated=Array.isArray(sim.result)&&sim.result.length===1?decodeFunctionResult({abi:ROUTER_ABI,functionName:'exactInputSingle',data:sim.result[0]}):null;
   if(typeof simulated!=='bigint'||simulated<amount(q.minOut))fail('SIMULATION_INVALID');
  }else if(sim.result!==true)fail('APPROVAL_REJECTED');
  const [estimate,fees]=await Promise.all([this.publicClient.estimateGas({account:this.address,to,data,value:0n}),this.publicClient.estimateFeesPerGas({type:'eip1559'})]);
  const gas=(safeBig(estimate)*120n+99n)/100n;if(gas<=0n||gas>1000000n)fail('GAS_LIMIT');
  const maxFeePerGas=safeBig(fees.maxFeePerGas),maxPriorityFeePerGas=safeBig(fees.maxPriorityFeePerGas);
  if(maxFeePerGas===0n||maxFeePerGas>this.maxFeePerGasWei||maxPriorityFeePerGas>maxFeePerGas)fail('FEE_LIMIT');
  const tx={chainId:BASE_CHAIN_ID,type:'eip1559',nonce:latest,to,data,value:0n,gas,maxFeePerGas,maxPriorityFeePerGas};
  const [l1Fee,operatorFee]=await Promise.all([this.read(BASE_ADDRESSES.gasOracle,GAS_ORACLE_ABI,'getL1Fee',[serializeTransaction(tx)]),this.read(BASE_ADDRESSES.gasOracle,GAS_ORACLE_ABI,'getOperatorFee',[gas])]);
  // L1/operator fees cannot be capped in an EIP-1559 transaction; reserve twice
  // the current estimate and recheck before broadcasting these exact bytes.
  const gasBudget=gas*maxFeePerGas+2n*(safeBig(l1Fee)+safeBig(operatorFee));
  if(gasBudget>this.maxGasWei||amount(q.nativeBalance,{zero:true})<gasBudget)fail('GAS_BUDGET');
  canonicalIntent(q,this.now());
  const rawTransaction=await this.account.signTransaction(tx),hash=keccak256(rawTransaction);
  const prepared={...record,nonce:latest,preparedAt:this.now(),rawTransaction,hash,gasBudgetWei:gasBudget.toString(),l1FeeEstimate:l1Fee.toString(),operatorFeeEstimate:operatorFee.toString(),beforeBalances:{token:q.tokenBalance,quote:q.quoteBalance,native:q.nativeBalance},data};
  await this.validate(prepared);return json(prepared);
 }catch(e){throw redacted(e);}}
 async validate(p){
  if(!object(p)||!['APPROVAL_RESET','APPROVE','SWAP'].includes(p.kind)||p.chainId!==BASE_CHAIN_ID||!same(p.from,this.address)||typeof p.rawTransaction!=='string'||p.rawTransaction.length>8192)fail('PREPARED_INVALID');
  const i=canonicalIntent(p,this.now(),{expired:true});
  integer(p.preparedAt,1,Number.MAX_SAFE_INTEGER,'PREPARED_INVALID');integer(p.nonce,0,Number.MAX_SAFE_INTEGER,'NONCE_INVALID');
  if(p.preparedAt>this.now()||p.preparedAt>i.deadline*1000||p.preparedAt-i.reference.observedAt>90000||i.reference.observedAt>p.preparedAt)fail('PREPARED_INVALID');
  const quote=addr(p.quoteToken);if(![BASE_ADDRESSES.usdc,BASE_ADDRESSES.weth].some(x=>same(x,quote)))fail('PREPARED_INVALID');
  if(i.reference.quoteTokenAddress&&!same(i.reference.quoteTokenAddress,quote))fail('PREPARED_INVALID');
  if(!same(p.tokenIn,i.side==='BUY'?quote:i.tokenAddress)||!same(p.tokenOut,i.side==='BUY'?i.tokenAddress:quote)||same(quote,i.tokenAddress))fail('PREPARED_INVALID');
  if(!((same(p.token0,i.tokenAddress)&&same(p.token1,quote))||(same(p.token1,i.tokenAddress)&&same(p.token0,quote)))||BigInt(p.token0)>=BigInt(p.token1))fail('PREPARED_INVALID');
  integer(p.fee,1,10000,'PREPARED_INVALID');
  if(amount(p.minOut)!==amount(p.quoteAmountOut)*BigInt(10000-i.slippageBps)/10000n)fail('PREPARED_INVALID');
  if(!object(p.beforeBalances)||['token','quote','native'].some(k=>typeof p.beforeBalances[k]!=='string'))fail('PREPARED_INVALID');
  for(const k of ['token','quote','native'])amount(p.beforeBalances[k],{zero:true});
  const expectedData=p.kind==='SWAP'?swapData(p):approvalData(p.kind,p),expectedTo=p.kind==='SWAP'?BASE_ADDRESSES.router:p.tokenIn,tx=parseTransaction(p.rawTransaction);
  const beforeAllowance=amount(p.allowanceBefore,{zero:true}),inputAmount=amount(i.amountIn);
  if((p.kind==='SWAP'&&beforeAllowance!==inputAmount)||(p.kind==='APPROVE'&&beforeAllowance!==0n)||(p.kind==='APPROVAL_RESET'&&(beforeAllowance===0n||beforeAllowance===inputAmount)))fail('PREPARED_INVALID');
  if(!same(p.to,expectedTo)||p.data!==expectedData||tx.type!=='eip1559'||tx.chainId!==BASE_CHAIN_ID||(tx.nonce??0)!==p.nonce||!same(tx.to,expectedTo)||tx.data!==expectedData||(tx.value??0n)!==0n||tx.authorizationList||tx.accessList?.length)fail('PREPARED_INVALID');
  if(typeof tx.gas!=='bigint'||tx.gas<=0n||tx.gas>1000000n||typeof tx.maxFeePerGas!=='bigint'||tx.maxFeePerGas<=0n||tx.maxFeePerGas>this.maxFeePerGasWei||(tx.maxPriorityFeePerGas??0n)>tx.maxFeePerGas)fail('PREPARED_INVALID');
  if(tx.gas*tx.maxFeePerGas>this.maxGasWei||amount(p.gasBudgetWei)<tx.gas*tx.maxFeePerGas||amount(p.gasBudgetWei)>this.maxGasWei||!same(keccak256(p.rawTransaction),p.hash)||!same(await recoverTransactionAddress({serializedTransaction:p.rawTransaction}),this.address))fail('PREPARED_INVALID');
  return tx;
 }
 async broadcast(p){try{
  const tx=await this.validate(p);await this.chain();if(this.now()>=p.deadline*1000)fail('DEADLINE_EXPIRED');
  const [l1,operator,native,mapped,latest,pending]=await Promise.all([this.read(BASE_ADDRESSES.gasOracle,GAS_ORACLE_ABI,'getL1Fee',[serializeTransaction({...tx,r:undefined,s:undefined,v:undefined,yParity:undefined})]),this.read(BASE_ADDRESSES.gasOracle,GAS_ORACLE_ABI,'getOperatorFee',[tx.gas]),this.publicClient.getBalance({address:this.address}),this.read(BASE_ADDRESSES.factory,FACTORY_ABI,'getPool',[p.token0,p.token1,p.fee]),...['latest','pending'].map(blockTag=>this.publicClient.getTransactionCount({address:this.address,blockTag}))]);
  if(!same(mapped,p.poolAddress))fail('POOL_UNSUPPORTED');
  integer(latest,0,Number.MAX_SAFE_INTEGER,'NONCE_INVALID');integer(pending,0,Number.MAX_SAFE_INTEGER,'NONCE_INVALID');
  if(latest!==p.nonce||pending<p.nonce||pending>p.nonce+1)fail('NONCE_BUSY');
  if(pending===p.nonce+1){
   const known=await this.publicClient.getTransaction({hash:p.hash});
   if(!known||!same(known.hash,p.hash)||!same(known.from,p.from)||!same(known.to,p.to)||known.input!==p.data||known.nonce!==p.nonce||known.value!==0n)fail('NONCE_BUSY');
  }
  const budget=tx.gas*tx.maxFeePerGas+2n*(safeBig(l1)+safeBig(operator));if(budget>this.maxGasWei||safeBig(native)<budget)fail('GAS_BUDGET');
  if(this.now()>=p.deadline*1000)fail('DEADLINE_EXPIRED');
  const hash=await this.walletClient.sendRawTransaction({serializedTransaction:p.rawTransaction});if(!same(hash,p.hash))fail('BROADCAST_IDENTITY_MISMATCH');return {hash:p.hash};
 }catch(e){throw redacted(e);}}
 async reconcile(p){try{
  const signed=await this.validate(p);await this.chain();let receipt;
  try{receipt=await this.publicClient.getTransactionReceipt({hash:p.hash});}catch(e){if(e?.name!=='TransactionReceiptNotFoundError')throw e;}
  if(!receipt){
   // A different transaction may have consumed this nonce. Never infer a fill,
   // cancellation or free reservation from a missing receipt or replacement.
   const nonce=await this.publicClient.getTransactionCount({address:this.address,blockTag:'latest'});
   integer(nonce,0,Number.MAX_SAFE_INTEGER,'NONCE_INVALID');if(nonce>p.nonce)fail('NONCE_CONSUMED');
   if(nonce<p.nonce)fail('NONCE_INVALID');
   return {status:'PENDING',hash:p.hash};
  }
  if(!same(receipt.transactionHash,p.hash)||!same(receipt.from,this.address)||!same(receipt.to,p.to)||typeof receipt.blockNumber!=='bigint'||!Array.isArray(receipt.logs))fail('RECEIPT_IDENTITY_MISMATCH');
  if(safeBig(receipt.gasUsed)===0n||receipt.gasUsed>signed.gas||safeBig(receipt.effectiveGasPrice)>signed.maxFeePerGas)fail('RECEIPT_INVALID');
  const latest=await this.publicClient.getBlockNumber();if(typeof latest!=='bigint'||latest<receipt.blockNumber)fail('RECEIPT_INVALID');
  if(latest-receipt.blockNumber+1n<2n)return {status:'PENDING',hash:p.hash};
  const [block,tx,operatorFee]=await Promise.all([this.publicClient.getBlock({blockNumber:receipt.blockNumber}),this.publicClient.getTransaction({hash:p.hash}),this.read(BASE_ADDRESSES.gasOracle,GAS_ORACLE_ABI,'getOperatorFee',[safeBig(receipt.gasUsed)],receipt.blockNumber)]);
  if(!same(block.hash,receipt.blockHash)||!same(tx.hash,p.hash)||!same(tx.from,this.address)||!same(tx.to,p.to)||tx.nonce!==p.nonce||tx.input!==p.data||tx.value!==0n)fail('RECEIPT_IDENTITY_MISMATCH');
  if(typeof receipt.l1Fee!=='bigint'||receipt.l1Fee<0n)fail('L1_FEE_UNKNOWN');
  const gasWei=safeBig(receipt.gasUsed)*safeBig(receipt.effectiveGasPrice)+receipt.l1Fee+safeBig(operatorFee);
  const result={kind:p.kind,hash:p.hash,gasWei:gasWei.toString(),blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash};
  const reverted=receipt.status==='reverted';
  if(!reverted&&receipt.status!=='success')fail('RECEIPT_INVALID');
  if(reverted&&receipt.logs.length)fail('RECEIPT_INVALID');
  let used=0n,out=0n;
  const ownLogs=receipt.logs.filter(log=>same(log.address,p.tokenIn)||same(log.address,p.tokenOut));
  const transfers=[],approvals=[];
  for(const log of ownLogs){
   let event;try{event=decodeEventLog({abi:ERC20_ABI,data:log.data,topics:log.topics,strict:true});}catch{continue;}
   if(event.eventName==='Transfer'&&(same(event.args.from,this.address)||same(event.args.to,this.address)))transfers.push({...event.args,address:log.address});
   if(event.eventName==='Approval'&&same(log.address,p.tokenIn)&&same(event.args.owner,this.address)&&same(event.args.spender,BASE_ADDRESSES.router))approvals.push(event.args.value);
  }
  const b=receipt.blockNumber,[tokenAfter,quoteAfter,nativeAfter,allowanceAfter,nonceAfter]=await Promise.all([this.read(p.tokenAddress,ERC20_ABI,'balanceOf',[this.address],b),this.read(p.quoteToken,ERC20_ABI,'balanceOf',[this.address],b),this.publicClient.getBalance({address:this.address,blockNumber:b}),this.read(p.tokenIn,ERC20_ABI,'allowance',[this.address,BASE_ADDRESSES.router],b),this.publicClient.getTransactionCount({address:this.address,blockNumber:b})]);
  if(nonceAfter!==p.nonce+1)fail('EXTERNAL_ACCOUNT_ACTIVITY');
  if(reverted){
   // A revert consumes gas and nonce, but must not alter ERC20 balances or
   // allowance. It needs the same canonical wallet checks as a successful fill.
   if(safeBig(allowanceAfter)!==amount(p.allowanceBefore,{zero:true}))fail('APPROVAL_EVENT_MISMATCH');
  }else if(p.kind==='SWAP'){
   if(transfers.length!==2)fail('TRANSFER_MISMATCH');
   const sent=transfers.filter(e=>same(e.address,p.tokenIn)&&same(e.from,this.address)&&same(e.to,p.poolAddress)),received=transfers.filter(e=>same(e.address,p.tokenOut)&&same(e.from,p.poolAddress)&&same(e.to,this.address));
   if(sent.length!==1||received.length!==1)fail('TRANSFER_MISMATCH');used=sent[0].value;out=received[0].value;
   if(used!==amount(p.amountIn)||out<amount(p.minOut)||safeBig(allowanceAfter)!==0n)fail('TRANSFER_MISMATCH');
   const swaps=[];for(const log of receipt.logs.filter(l=>same(l.address,p.poolAddress))){try{const e=decodeEventLog({abi:POOL_ABI,data:log.data,topics:log.topics,strict:true});if(e.eventName==='Swap')swaps.push(e.args);}catch{}}
   if(swaps.length!==1||!same(swaps[0].sender,BASE_ADDRESSES.router)||!same(swaps[0].recipient,this.address))fail('SWAP_EVENT_MISMATCH');
   const input0=same(p.tokenIn,p.token0);if((input0?swaps[0].amount0:swaps[0].amount1)!==used||(input0?swaps[0].amount1:swaps[0].amount0)!==-out)fail('SWAP_EVENT_MISMATCH');
  }else{
   const expected=p.kind==='APPROVAL_RESET'?0n:amount(p.amountIn);
   if(transfers.length||approvals.length!==1||approvals[0]!==expected||safeBig(allowanceAfter)!==expected)fail('APPROVAL_EVENT_MISMATCH');
  }
  const beforeToken=amount(p.beforeBalances.token,{zero:true}),beforeQuote=amount(p.beforeBalances.quote,{zero:true});
  const expectedToken=p.kind!=='SWAP'?beforeToken:p.side==='BUY'?beforeToken+out:beforeToken-used,expectedQuote=p.kind!=='SWAP'?beforeQuote:p.side==='BUY'?beforeQuote-used:beforeQuote+out;
  if(safeBig(tokenAfter)!==expectedToken||safeBig(quoteAfter)!==expectedQuote||amount(p.beforeBalances.native,{zero:true})-safeBig(nativeAfter)!==gasWei)fail('BALANCE_RECONCILIATION_MISMATCH');
  const canonical=await this.publicClient.getBlock({blockNumber:b});if(!same(canonical.hash,receipt.blockHash))fail('REORG_DETECTED');
  return {...result,status:reverted?'REVERTED':'CONFIRMED',amountIn:used.toString(),amountOut:out.toString()};
 }catch(e){return {status:'UNKNOWN',hash:typeof p?.hash==='string'?p.hash:null,code:redacted(e).code};}}
}
