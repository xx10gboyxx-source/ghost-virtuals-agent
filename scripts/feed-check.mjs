import {createBaseMemeFeed} from '../server/base-meme-feed.mjs';
import {evaluateMeme} from '../server/meme-strategy.mjs';

// One read-only scan. Does not create a ledger, start a session or use inference.
const pools=process.argv.length>2?process.argv.slice(2):
 (process.env.GHOST_BASE_POOLS||'').split(',').map(value=>value.trim()).filter(Boolean);
try {
 if(!pools.length)throw new Error('No pools configured.');
 const snapshots=await createBaseMemeFeed({pools}).snapshots();
 const checkedAt=Date.now();
 console.log(JSON.stringify({checkedAt,networkReadSucceeded:true,liveOrders:false,
  markets:snapshots.map(snapshot=>({
   poolAddress:snapshot.poolAddress,tokenAddress:snapshot.tokenAddress,
   observedAt:snapshot.observedAt,priceUsd:snapshot.priceUsd,
   liquidityUsd:snapshot.liquidityUsd,volume24hUsd:snapshot.volume24hUsd,
   candleCount:snapshot.candles.length,
   latestCandleAt:snapshot.candles.at(-1)?.time??null,
   expectedLatestClosedCandleAt:Math.floor(checkedAt/300000)*300-300,
   hasLatestClosedCandle:snapshot.candles.some(c=>c.time===Math.floor(checkedAt/300000)*300-300),
   securityPresent:!!snapshot.security,
   top10HolderPct:snapshot.security?.top10HolderPct??null,
   decision:evaluateMeme(snapshot,{now:checkedAt})
  }))},null,2));
} catch {
 console.log(JSON.stringify({networkReadSucceeded:false,liveOrders:false,
  status:'WAIT',code:'FEED_CHECK_UNAVAILABLE',
  reason:'Supply one or two valid Base pool addresses and check provider connectivity.'}));
 process.exitCode=1;
}
