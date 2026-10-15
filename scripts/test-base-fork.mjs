// Opt-in contract integration. All writes go to a child Anvil process on loopback.
// A read-only RPC proxy prevents Anvil from forwarding a write to public Base.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,openSync,writeSync,fsyncSync,closeSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPublicClient,createWalletClient,http,keccak256,stringToHex,parseAbi,toHex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {base} from 'viem/chains';
import {BASE_ADDRESSES as A,BaseSwapBroker,ERC20_ABI,QUOTER_ABI} from '../live/base-broker.mjs';

const BLOCK=35000000n,BLOCK_HASH='0x9048f68cfd29ae6ce36647ace74ebdf5bffcef8528dd8183df6e3a01a92f2d18';
const TOKEN='0x532f27101965dd16442e59d40670faf5ebb142e4',POOL='0xBA3F945812a83471d709BCe9C3CA699A19FB46f7';
const UPSTREAM='https://mainnet.base.org';
const READS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getBalance','eth_getCode','eth_getStorageAt','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getLogs','eth_getProof','eth_call','web3_clientVersion','net_version']);
const methods=new Set(),results=[],account=privateKeyToAccount(keccak256(stringToHex('GhOsT PUBLIC UNFUNDED BASE FORK TEST ONLY')));
const bin=process.env.ANVIL_BIN??'anvil';
const version=execFileSync(bin,['--version'],{encoding:'utf8'}).split('\n')[0];
assert.match(version,/Version: 1\.7\.1\b/,'Reproduce with pinned Anvil 1.7.1');
const dir=mkdtempSync(join(tmpdir(),'ghost-base-fork-'));
const proxy=createServer(async(req,res)=>{
 try{
  let bytes='';for await(const chunk of req){bytes+=chunk;if(bytes.length>1000000)throw new Error('oversized RPC');}
  const body=JSON.parse(bytes),calls=Array.isArray(body)?body:[body];
  if(calls.some(call=>!READS.has(call.method))){res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:body.id??null,error:{code:-32601,message:'Read-only fork upstream'}}));return;}
  calls.forEach(call=>methods.add(call.method));
  const response=await fetch(UPSTREAM,{method:'POST',headers:{'content-type':'application/json'},body:bytes,signal:AbortSignal.timeout(20000)});
  res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
 }catch{res.writeHead(502);res.end('Fork upstream unavailable');}
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
const proxyUrl=`http://127.0.0.1:${proxy.address().port}`;
// Reserve an ephemeral port, then immediately hand it to our own child process.
const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const url=`http://127.0.0.1:${port}`,child=spawn(bin,['--host','127.0.0.1','--port',String(port),'--accounts','0','--chain-id','8453','--network','optimism','--fork-url',proxyUrl,'--fork-block-number',String(BLOCK),'--retries','0','--timeout','25000','--silent'],{stdio:'ignore'});
let childError;child.on('error',e=>{childError=e;});
const publicClient=createPublicClient({chain:base,cacheTime:0,transport:http(url,{timeout:30000,retryCount:0})});
const walletClient=createWalletClient({chain:base,account,transport:http(url,{timeout:30000,retryCount:0})});
const rpc=(method,params=[])=>publicClient.request({method,params});
const balance=(token)=>publicClient.readContract({address:token,abi:ERC20_ABI,functionName:'balanceOf',args:[account.address]});
let now;
const broker=new BaseSwapBroker({publicClient,walletClient,account,clock:()=>now,maxGasWei:'1000000000000000'});
async function transact(side,amountIn){
 const market=await broker.inspect({poolAddress:POOL,tokenAddress:TOKEN}),buy=side==='BUY';
 // Reference derived from the fork's pre-trade quote is a test fixture only,
 // not independent market-price or strategy evidence (covered offline).
 const q=await publicClient.simulateContract({address:A.quoter,abi:QUOTER_ABI,functionName:'quoteExactInputSingle',args:[{tokenIn:buy?A.weth:TOKEN,tokenOut:buy?TOKEN:A.weth,amountIn,fee:market.fee,sqrtPriceLimitX96:0n}]});
 const price=buy?Number(amountIn)/Number(q.result[0]):Number(q.result[0])/Number(amountIn);
 for(let step=0;step<3;step++){
  const b=await publicClient.getBlock();now=Number(b.timestamp)*1000;
  const p=await broker.prepare({poolAddress:POOL,tokenAddress:TOKEN,side,amountIn:String(amountIn),slippageBps:100,maxPriceImpactBps:300,deadline:Number(b.timestamp)+180,reference:{tokenPriceUsd:price,quotePriceUsd:1,quoteTokenAddress:A.weth,observedAt:now}});
  // The broker's pre-broadcast durability contract is also honored on this fork.
  const file=join(dir,`${p.hash}.json`),fd=openSync(file,'wx',0o600);try{writeSync(fd,JSON.stringify(p));fsyncSync(fd);}finally{closeSync(fd);}
  const persisted=JSON.parse(readFileSync(file,'utf8'));await broker.broadcast(persisted);
  const receipt=await publicClient.waitForTransactionReceipt({hash:p.hash,timeout:30000});assert.equal(receipt.status,'success');
  await rpc('anvil_mine',['0x1']);
  const rawReceipt=await rpc('eth_getTransactionReceipt',[p.hash]);
  const r=await broker.reconcile(persisted);results.push({side,kind:p.kind,hash:p.hash,receiptStatus:receipt.status,rawReceiptHasL1Fee:Object.hasOwn(rawReceipt,'l1Fee'),reconciliation:r});
  console.log(JSON.stringify({stage:`${side} ${p.kind}`,receipt:receipt.status,reconciliation:r.status,code:r.code??null}));
  assert.equal(r.status,'CONFIRMED',`Fork reconciliation failed: ${r.code}. Do not weaken production fee/balance checks to pass this test.`);
  if(p.kind==='SWAP')return BigInt(r.amountOut);
 }
 throw new Error('Bounded approval/swap sequence did not finish');
}
try{
 let ready=false;for(let i=0;i<100;i++){
  if(childError)throw childError;if(child.exitCode!==null)throw new Error('Anvil exited before startup');
  try{assert.match(await rpc('web3_clientVersion'),/anvil/i);ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}
 }
 assert.ok(ready,'Local Anvil unavailable');assert.equal(await publicClient.getChainId(),8453);
 assert.equal((await publicClient.getBlock({blockNumber:BLOCK})).hash,BLOCK_HASH);
 const metadata=await rpc('anvil_metadata');assert.equal(BigInt(metadata.forkedNetwork.forkBlockNumber),BLOCK);assert.equal(metadata.forkedNetwork.forkBlockHash,BLOCK_HASH);
 // Artificial ETH exists only in this disposable local fork. No real account
 // is funded, impersonated, imported or configured for live trading.
 await rpc('anvil_setBalance',[account.address,toHex(10n**18n)]);
 const deposit=await walletClient.writeContract({address:A.weth,abi:parseAbi(['function deposit() payable']),functionName:'deposit',value:10n**16n});
 assert.equal((await publicClient.waitForTransactionReceipt({hash:deposit})).status,'success');
 const beforeToken=await balance(TOKEN),beforeWeth=await balance(A.weth),input=10n**12n;
 const bought=await transact('BUY',input);assert.equal(await balance(TOKEN),beforeToken+bought);assert.equal(await balance(A.weth),beforeWeth-input);
 const returned=await transact('SELL',bought);assert.equal(await balance(TOKEN),beforeToken);assert.equal(await balance(A.weth),beforeWeth-input+returned);
 console.log(JSON.stringify({status:'PASS',anvil:version,block:String(BLOCK),blockHash:BLOCK_HASH,route:{token:TOKEN,pool:POOL,quote:A.weth},results,upstreamMethods:[...methods].sort(),mainnetTransactions:0,scope:'Local Base fork, real contract execution; no funded mainnet or strategy performance evidence'},null,2));
}catch(error){console.error(JSON.stringify({status:'FAILED_OR_UNVERIFIED',anvil:version,block:String(BLOCK),blockHash:BLOCK_HASH,message:error.message,results,upstreamMethods:[...methods].sort(),mainnetTransactions:0},null,2));process.exitCode=1;}
finally{child.kill('SIGTERM');const closed=new Promise(resolve=>proxy.close(resolve));proxy.closeAllConnections();await closed;rmSync(dir,{recursive:true,force:true});}
