// Offline RPC boundary fixture. Real viem ABI encoding, EIP-1559 signatures and
// recovery; no socket, provider, wallet credential or mainnet submission exists.
import {privateKeyToAccount} from 'viem/accounts';
import {encodeAbiParameters,encodeEventTopics,encodeFunctionResult,keccak256,parseTransaction,stringToHex} from 'viem';
import {BASE_ADDRESSES as A,BaseSwapBroker,ERC20_ABI,POOL_ABI,ROUTER_ABI} from '../../live/base-broker.mjs';
export const TOKEN='0x1111111111111111111111111111111111111111';
export const POOL='0x2222222222222222222222222222222222222222';
export const OTHER='0x3333333333333333333333333333333333333333';
export const T=Date.parse('2026-01-01T12:00:00Z');
const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
const blockHash=n=>`0x${n.toString(16).padStart(64,'0')}`;
const missing=()=>Object.assign(new Error('not found'),{name:'TransactionReceiptNotFoundError'});
export function transfer(address,from,to,value){return {address,topics:encodeEventTopics({abi:ERC20_ABI,eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters([{type:'uint256'}],[value])};}
export function approval(address,owner,value){return {address,topics:encodeEventTopics({abi:ERC20_ABI,eventName:'Approval',args:{owner,spender:A.router}}),data:encodeAbiParameters([{type:'uint256'}],[value])};}
export function swapLog(p,used,out){const input0=same(p.tokenIn,p.token0);return {address:POOL,topics:encodeEventTopics({abi:POOL_ABI,eventName:'Swap',args:{sender:A.router,recipient:p.from}}),data:encodeAbiParameters([{type:'int256'},{type:'int256'},{type:'uint160'},{type:'uint128'},{type:'int24'}],[input0?used:-out,input0?-out:used,2n**96n,1000000n,0])};}
export function rpcFixture(options={}){
 const realAccount=privateKeyToAccount(keccak256(stringToHex('GhOsT PUBLIC UNFUNDED TEST ACCOUNT ONLY')));
 const h={at:T,block:100n,head:101n,quoteToken:options.quoteToken??A.usdc,tokenUsd:2,quoteUsd:1,
  factory:A.factory,mapping:POOL,fee:3000,tokenDecimals:18,quoteDecimals:options.quoteToken===A.weth?18:6,
  token:20n*10n**18n,quote:100n*10n**BigInt(options.quoteToken===A.weth?18:6),native:10n**18n,
  allowance:0n,nonce:0,estimate:100000n,fees:{maxFeePerGas:10000000n,maxPriorityFeePerGas:1000000n},l1:10000n,operator:1000n,
  signed:[],sent:[],reads:[],transactions:new Map(),receipts:new Map(),snapshots:new Map(),pending:new Map()};
 h.account={...realAccount,signTransaction:async tx=>{h.signed.push(structuredClone(tx));return realAccount.signTransaction(tx);}};
 h.snapshot=()=>({token:h.token,quote:h.quote,native:h.native,allowance:h.allowance,nonce:h.nonce});
 const state=bn=>bn===undefined||bn===h.block?h:h.snapshots.get(bn)??h;
 h.output=(tokenIn,amountIn)=>{
  const buy=same(tokenIn,h.quoteToken),inDecimals=buy?h.quoteDecimals:h.tokenDecimals,outDecimals=buy?h.tokenDecimals:h.quoteDecimals;
  return BigInt(Math.floor(Number(amountIn)/10**inDecimals*(buy?h.quoteUsd/h.tokenUsd:h.tokenUsd/h.quoteUsd)*10**outDecimals));
 };
 h.client={
  getChainId:async()=>8453,
  getBlock:async({blockNumber}={})=>({number:blockNumber??h.block,hash:blockHash(blockNumber??h.block),timestamp:BigInt(Math.floor(h.at/1000))}),
  getBlockNumber:async()=>h.head,
  getBalance:async({blockNumber}={})=>state(blockNumber).native,
  getTransactionCount:async({blockTag,blockNumber}={})=>blockTag==='pending'?h.nonce+h.pending.size:state(blockNumber).nonce,
  readContract:async call=>{
   h.reads.push(call);const {address,functionName:f,args=[],blockNumber}=call,s=state(blockNumber);
   if(f==='factory')return h.factory;if(f==='token0')return TOKEN;if(f==='token1')return h.quoteToken;if(f==='fee')return h.fee;
   if(f==='getPool')return h.mapping;
   if(f==='decimals')return same(address,TOKEN)?h.tokenDecimals:h.quoteDecimals;
   if(f==='balanceOf')return same(address,TOKEN)?s.token:s.quote;
   if(f==='allowance')return s.allowance;
   if(f==='getL1Fee')return h.l1;if(f==='getOperatorFee')return h.operator;
   throw new Error(`Unexpected fixture read: ${f} ${args.length}`);
  },
  simulateContract:async({functionName:f,args})=>{
   if(f==='quoteExactInputSingle')return {result:[h.output(args[0].tokenIn,args[0].amountIn),2n**96n,0,100000n]};
   if(f==='approve')return {result:true};
   if(f==='multicall')return {result:[encodeFunctionResult({abi:ROUTER_ABI,functionName:'exactInputSingle',result:h.simulatedOut??10n**30n})]};
   throw new Error(`Unexpected fixture simulation: ${f}`);
  },
  estimateGas:async()=>h.estimate,estimateFeesPerGas:async()=>h.fees,
  getTransaction:async({hash})=>{const tx=h.transactions.get(hash);if(!tx)throw new Error('transaction not found');return tx;},
  getTransactionReceipt:async({hash})=>{const r=h.receipts.get(hash);if(!r)throw missing();return r;}
 };
 h.wallet={sendRawTransaction:async({serializedTransaction})=>{
  const hash=keccak256(serializedTransaction),tx=parseTransaction(serializedTransaction);
  h.sent.push(serializedTransaction);h.transactions.set(hash,{...tx,hash,from:realAccount.address,input:tx.data,nonce:tx.nonce??0,value:tx.value??0n});h.pending.set(hash,tx);return hash;
 }};
 h.broker=new BaseSwapBroker({account:h.account,clock:()=>h.at,publicClient:h.client,walletClient:h.wallet,maxGasWei:'5000000000000',...options});
 h.input=(overrides={})=>({poolAddress:POOL,tokenAddress:TOKEN,side:'BUY',amountIn:'10000000',slippageBps:100,maxPriceImpactBps:300,
  reference:{tokenPriceUsd:h.tokenUsd,quotePriceUsd:h.quoteUsd,observedAt:h.at,quoteTokenAddress:h.quoteToken},deadline:Math.floor(h.at/1000)+180,...overrides});
 h.mine=(p,{status='success',out=BigInt(p.quoteAmountOut),used=BigInt(p.amountIn),gasUsed=80000n}={})=>{
  h.snapshots.set(h.block,h.snapshot());h.block++;h.head=h.block+1n;
  const gas=gasUsed*h.fees.maxFeePerGas+h.l1+h.operator;
  h.native-=gas;h.nonce=p.nonce+1;h.pending.delete(p.hash);
  const tx=parseTransaction(p.rawTransaction);h.transactions.set(p.hash,{...tx,hash:p.hash,from:p.from,input:p.data,nonce:p.nonce,value:0n});
  let logs=[];
  if(status==='success'){
   if(p.kind==='SWAP'){
    if(p.side==='BUY'){h.quote-=used;h.token+=out;}else{h.token-=used;h.quote+=out;}h.allowance=0n;
    logs=[transfer(p.tokenIn,p.from,POOL,used),transfer(p.tokenOut,POOL,p.from,out),swapLog(p,used,out)];
   }else{h.allowance=p.kind==='APPROVAL_RESET'?0n:used;logs=[approval(p.tokenIn,p.from,h.allowance)];}
  }
  const receipt={transactionHash:p.hash,from:p.from,to:p.to,blockNumber:h.block,blockHash:blockHash(h.block),gasUsed,effectiveGasPrice:h.fees.maxFeePerGas,l1Fee:h.l1,status,logs};
  h.receipts.set(p.hash,receipt);return receipt;
 };
 return h;
}
