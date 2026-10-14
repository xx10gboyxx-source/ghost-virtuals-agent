# Agent behavior

GhOsT v0.3 researches caller-selected Base meme-token pools and models paper trades.
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
is a constrained workflow, not a general autonomous planner or hosted ACP service.

See the README for experimental thresholds and operational limitations, and the
reviewer guide for commands that reproduce each capability.
