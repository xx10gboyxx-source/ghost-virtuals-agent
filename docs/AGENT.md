# Agent behavior

GhOsT v0.4 researches Base meme-token pools and models simulated trades.
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
missing sell evidence leaves the position unresolved. No real orders are possible.

Research tasks inspect sanitized recorded data through two fixed local tools.
Optional Virtuals output must cite known evidence IDs, and cannot change the
assessment. Correct citation IDs do not establish semantic accuracy. The agent
is a constrained workflow. A separate persistent ACP worker serves the bounded
`ghost_base_meme_scan` request through an externally authenticated official CLI.
Its local lifecycle tests pass; hosted delivery and settlement are unverified.
That worker can sign provider actions through the CLI when configured, but does
not execute token swaps. See [ACP_WORKER.md](ACP_WORKER.md).

See the README for experimental thresholds and operational limitations, and the
reviewer guide for commands that reproduce each capability.
