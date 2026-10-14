# Agent behavior

GhOsT v0.5 supports Base meme-token research, simulation and a separate user-run
live executor. The [public portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/)
provides hosted research; live trading requires the user's own configured wallet
and running host. Funded mainnet and fork-based end-to-end execution remain
unverified; hosted unattended customer trading is not deployed.

## Research and simulation

`npm start` runs continuous wallet-free research, automatically discovers supported
pools for a bounded token watchlist and saves both strategy reports. It needs no
API key, credits or funding. See [OPERATING.md](OPERATING.md).
The active plan is: read pool/candle/security evidence, screen risk, evaluate a
volume-breakout or trend-pullback signal, retain a paper ledger, explain results.

`MemeOperator` uses only the Base feed and meme strategy. The retained Polymarket
source excerpts are not imported by active commands. The new database has its own
schema and rejects a legacy BTC ledger instead of reusing simulated balances.

Missing security, unsafe token controls, weak liquidity, bad candle history and
stale evidence cannot authorize an entry. Paper fills require a fresh observation
strictly after the order was created. Stops and targets request a later paper sale;
missing sell evidence leaves the position unresolved. This research/simulation
path cannot place real orders.

## Separate live execution

`live/run.mjs` uses the same two strategies but a distinct live journal and broker.
It implements canonical Base Uniswap v3 route checks, exact ERC20 approvals,
bounded real swaps, receipt/balance reconciliation and monitored exits. Pools must
quote the selected token in USDC or WETH; simulation balances are never imported.
Only explicitly running the configured live commands can submit swaps. The code
is present, but the published automated suite does not exercise this executor.
See [LIVE.md](LIVE.md) for commands, limits and unresolved-transaction handling.

## Explanations and ACP research jobs

Research tasks inspect sanitized recorded data through two fixed local tools.
Optional Virtuals output must cite known evidence IDs, and cannot change the
assessment. Correct citation IDs do not establish semantic accuracy. The agent
is a constrained workflow. A separate persistent ACP worker serves the bounded
`ghost_base_meme_scan` request through an externally authenticated official CLI.
Its local lifecycle tests pass; hosted delivery and settlement are unverified.
That worker can sign provider actions through the CLI when configured, but does
not execute token swaps. See [ACP_WORKER.md](ACP_WORKER.md).

See the [README](../README.md) for experimental thresholds and operational
limitations, and the [reviewer guide](REVIEW_GUIDE.md) for reproducible evidence
and the remaining validation gaps.
