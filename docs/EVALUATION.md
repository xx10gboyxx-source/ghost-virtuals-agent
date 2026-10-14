# Evaluation evidence

Run `npm test` for 136 software tests and `npm run evaluate` for two independent
10-case synthetic evaluations. `npm run demo` uses synthetic Base token snapshots
and a temporary SQLite ledger; it performs no model, network or wallet operation.

Tests cover both meme strategies, stale/missing data, closed-candle integrity,
Base identity, unknown and unsafe token flags, holder/tax limits, provider failures,
request budgets, later-quote execution, costs, price gaps, persistent risk locks,
concurrency, legacy BTC-ledger rejection and read-only model reporting.

Runtime/discovery tests also cover first startup, a complete simulated buy/sell,
report persistence, pause and expiry, clock regression, incompatible adoption,
concurrent workers, token allowlists and provider cooldowns across restart.
`npm run runtime:demo` executes four synthetic cycles through the production
runtime, then reopens the saved ledger and verifies recovery.

Committed examples:
- `examples/demo-output.json`: synthetic paper entry/exit report sequence.
- `examples/meme-evaluation.json`: 10 meme-market fixture outcomes.
- `examples/task-evaluation.json`: 10 research-task fixture outcomes.
- `examples/research-task.json`: example bounded research report.
- `evidence/tests.txt`: fresh test runner output.

No measured win rate, return, Sharpe ratio, real-provider model quality or
production reliability is claimed. Tests validate behavior against supplied data.
A live study would need original timestamped observations, rejected candidates,
costs, missing-data records and subsequent outcomes with no retrospective edits.
