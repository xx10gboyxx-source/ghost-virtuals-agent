# Evaluation evidence — GhOsT v0.5

Run `npm test` for 218 automated tests, including 82 live execution tests, and
`npm run evaluate` for two independent 10-case synthetic evaluations.
`npm run test:live` runs just the dedicated broker and agent cases.
`npm run demo` uses synthetic Base token snapshots
and a temporary SQLite ledger; it performs no model, network or wallet operation.

The 2026-10-14 documentation review reproduced a baseline total of 136 cases from commit
`75a0ddf98c9abfef639689d511570319ec060b9e` using Node.js 24.19.0. See the
[historical review evidence](../evidence/docs-review.json). Earlier 161-test claims
could not be reproduced at that commit, which had no live-module test imports.
The subsequent execution contribution adds 60 broker cases and 22 agent cases
using real viem signing/encoding and SQLite with deterministic RPC responses.
Seven broker regressions were reproduced against the original implementation.
See [live-execution coverage and limits](LIVE_EXECUTION_TESTS.md) and the
[fresh combined verification](../evidence/integration-verification.json).
Offline coverage does not establish actual EVM, sequencer or funded behavior.

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
- [docs-review.json](../evidence/docs-review.json): historical documentation baseline and limits.
- [live-execution-verification.json](../evidence/live-execution-verification.json): execution contribution, regressions and failed fork attempt.
- [integration-verification.json](../evidence/integration-verification.json): fresh combined verification and preserved boundaries.

`npm run check:docs` checks local Markdown links, release labels, metadata paths,
documented test counts, the live configuration example and known stale capability
denials. In CI, `--tap` also compares the actual complete test run with the recorded
count and requires zero failures/skips. It makes no remote requests and cannot
establish the truth of every claim.

The public portal returned HTTP 200 for its HTML during the original documentation review. That supports
page reachability only, not sustained uptime, scan API correctness, customer
adoption, ACP delivery or real trading. Historical feed observations in
[HOSTING.md](HOSTING.md) and the smoke JSON files retain their original scope;
their hosting statements are not a current project-wide deployment status.

## Remaining live and commercial validation

Review signer and recovery security independently and verify a full route on a
Base fork before collecting
separately authorized funded-operation evidence. Record receipts, balances, gas,
exit failures, outages and restart outcomes. Neither a successful read-only wallet
check nor passing deterministic signing/recovery tests establishes funded reliability.
The pinned Anvil fork successfully executed a local deposit and approval but its
receipt omitted `l1Fee`; the broker correctly returned `UNKNOWN / L1_FEE_UNKNOWN`
and the strict harness failed before swapping. Full fork execution remains
unverified; no fee data or confirmation is substituted to pass the test.
Unattended hosted customer trading is not deployed or verified. Authenticated ACP
delivery/settlement and real-provider inference quality remain separate gaps.

No measured win rate, return, Sharpe ratio, real-provider model quality, customer
adoption, sponsorship, credit approval or production reliability is claimed.
Tests validate behavior against supplied data.
A live study would need original timestamped observations, rejected candidates,
costs, missing-data records and subsequent outcomes with no retrospective edits.
