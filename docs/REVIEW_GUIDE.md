# GhOsT v0.5 reviewer guide

GhOsT provides Base meme-coin research, simulation and a separate user-run live
executor. The [public portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/)
hosts live-feed research. Live trading requires a separately configured wallet
and running user-managed host; opening the portal does not create a trading account.
Funded mainnet and fork-based end-to-end execution remain unverified. Hosted
unattended customer trading is not deployed or verified. The separate ACP research
offering remains hidden pending authenticated delivery and settlement validation.

## Reproduce published evidence

Use Node.js 24+. Installation downloads the pinned dependency; subsequent checks
below are offline and require no wallet, key, inference credits or funds.

```sh
git clone https://github.com/xx10gboyxx-source/ghost-virtuals-agent.git
cd ghost-virtuals-agent
npm ci --ignore-scripts
npm test
npm run demo
npm run runtime:demo
npm run agent:demo
npm run evaluate
npm run check:public
npm run check:docs
```

The public checkout reproduces 218 automated tests, including 82 live execution
tests, and 20 synthetic evaluation cases. The live tests use real viem signing and
SQLite with deterministic RPC fixtures; they do not establish actual EVM execution
or funded reliability. The earlier baseline had a total of 136 cases and no live
imports. The Base-fork attempt remains failed/unverified due to missing L1 receipt fees.
See [EVALUATION.md](EVALUATION.md) for the evidence boundary and remaining work.

| Capability | Implementation | Reproducible evidence or gap |
| --- | --- | --- |
| Continuous no-money research | `agent/runtime.mjs` + `agent/run.mjs` | Runtime lifecycle, recovery, report and rate-budget tests |
| Automatic token-pool discovery | `server/pool-discovery.mjs` | Identity, liquidity selection, timeout and cache tests |
| Base spot pool and risk data | `server/base-meme-feed.mjs` + `server/meme-strategy.mjs` | Identity, missing/flagged evidence, tax, holders and provider-failure tests |
| Volume breakout and trend pullback | `evaluateMeme` | Eligible fixtures and chase/volume/history rejection tests |
| Later-quote simulated execution | `operator.mjs` | Persistence, costs, exits, risk/session locks and concurrency tests |
| BTC ledger isolation | `MemeOperator` constructor | Legacy-ledger rejection test; historical outcome-contract files are inactive |
| Evidence-linked research / optional inference | `agent/task.mjs` + `agent/reporter.mjs` | Citation, freshness, immutability and synthetic HTTP tests; real model quality unverified |
| ACP research worker | `agent/acp-cli.mjs` + `agent/acp-worker.mjs` | Simulated CLI lifecycle tests; hosted authenticated delivery unverified |
| Live signing and bounded swaps | `live/base-broker.mjs` | 60 broker cases with real signing/encoding and deterministic RPC fixtures |
| Live positions, receipts, exits and recovery | `live/agent.mjs` | 22 agent cases with real broker and SQLite; funded/full fork operation unverified |
| Public research portal | Separate published service | Public interface available; no sustained-uptime, customer or execution evidence |

## Interpret signals and execution correctly

Both strategies use closed, contiguous 5-minute candles for Base spot tokens,
not BTC 15-minute outcome contracts. Volume breakout requires a close above the
prior 20-candle high, at least 2× prior mean volume and EMA20 above EMA50, with a
chase limit. Trend pullback requires a bullish recovery near EMA20, EMA20 above
EMA50, RSI 45–68 and at least 1.2× prior mean volume. These are experimental rules,
not evidence of an investment edge.

The input schema uses millisecond timestamps except `candles[].time` (Unix seconds).
Pool/token addresses must identify Base chain 8453. `screenMeme` checks supplied
evidence; it cannot authenticate a caller-created object. Provider-origin checks
are in the feed. A passing screen never guarantees future sellability.

Research PASS is not authorization to trade. A user who separately configures and
runs the live executor enables real transaction submission when its checks pass.
That path supports canonical Uniswap v3 pools with USDC or WETH quote assets and
uses its own persistent journal. See [LIVE.md](LIVE.md) and [SECURITY.md](../SECURITY.md)
for signer, route, host, gas and recovery limitations. The read-only `live check`
command cannot establish that a trade will fill or that operation is reliable.

## Intended credit use

Only two explanation tasks are allowed: `explain-wait` and `session-review`.
They inspect sanitized recorded evidence. Models cannot choose tools, access
signers, change risk settings or control the operator. Optional credits would fund
evaluation of evidence fidelity, uncertainty, latency and credit use, not trades
or hosting. See [CREDIT_REVIEW.md](CREDIT_REVIEW.md).

No real-provider model-quality result, customer adoption, sponsorship, investment
return or credit approval is established. Source is public under [NOTICE](../NOTICE),
not open-source licensed. Public code supplies reviewable evidence; it cannot
guarantee automatic detection or approval. Manual review is requested.

## External contracts and deployment evidence

- [GeckoTerminal API](https://api.geckoterminal.com/docs/index.html)
- [GoPlus token security](https://docs.gopluslabs.io/reference/tokensecurityusingget_1)
- [GoPlus response meanings](https://docs.gopluslabs.io/reference/response-details)
- [Virtuals Compute](https://os.virtuals.io/agent-identity/compute/overview)
- [Uniswap Base v3 deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments)

Historical provider checks from 2026-10-14 are recorded in [HOSTING.md](HOSTING.md).
They are bounded observations, not sustained service validation. [READINESS.md](READINESS.md)
separates portal availability, local execution capability and unresolved ACP work.
No provider field, test score or screen is an investment endorsement.
