# Evaluation evidence — GhOsT v0.5

Run `npm test` for 136 automated tests and `npm run evaluate` for two independent
10-case synthetic evaluations. `npm run demo` uses synthetic Base token snapshots
and a temporary SQLite ledger; it performs no model, network or wallet operation.

The 2026-10-14 documentation review reproduced these results from source commit
`75a0ddf98c9abfef639689d511570319ec060b9e` using Node.js 24.19.0. See the
[review evidence](../evidence/docs-review.json). Earlier 161-test claims could not
be reproduced: the published suite contains no tests importing `live/`. Live
signing, RPC receipt reconciliation and live restart tests described in earlier
documentation are absent from this checkout. Their implementation exists, but
the available test count must not be presented as live-executor coverage.

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

- [demo-output.json](../examples/demo-output.json): synthetic entry/exit report sequence.
- [meme-evaluation.json](../examples/meme-evaluation.json): 10 meme-market fixture outcomes.
- [task-evaluation.json](../examples/task-evaluation.json): 10 research-task fixture outcomes.
- [research-task.json](../examples/research-task.json): bounded research report.
- [tests.txt](../evidence/tests.txt): historical earlier-release output, retained as recorded.
- [docs-review.json](../evidence/docs-review.json): current reproduction summary and limits.

`npm run check:docs` checks local Markdown links, release labels, metadata paths,
documented test counts, the live configuration example and known stale capability
denials. It makes no remote requests and cannot establish the truth of every claim.

The public portal returned HTTP 200 for its HTML during this review. That supports
page reachability only, not sustained uptime, scan API correctness, customer
adoption, ACP delivery or real trading. Historical feed observations in
[HOSTING.md](HOSTING.md) and the smoke JSON files retain their original scope;
their hosting statements are not a current project-wide deployment status.

## Remaining live and commercial validation

Publish reproducible automated live-executor tests, review signer and recovery
security independently, and verify a full route on a Base fork before collecting
separately authorized funded-operation evidence. Record receipts, balances, gas,
exit failures, outages and restart outcomes. Neither a successful read-only wallet
check nor an available signing implementation establishes funded reliability.
Unattended hosted customer trading is not deployed or verified. Authenticated ACP
delivery/settlement and real-provider inference quality remain separate gaps.

No measured win rate, return, Sharpe ratio, real-provider model quality, customer
adoption, sponsorship, credit approval or production reliability is claimed.
Tests validate behavior against supplied data.
A live study would need original timestamped observations, rejected candidates,
costs, missing-data records and subsequent outcomes with no retrospective edits.
