# GhOsT operating-readiness audit — 2026-10-14

**Not ready for real trading funds.** Adding money or inference credits does not
start trading. The code implements Base meme research, a simulation operator and
an ACP research-job worker. It has no real token executor or real exit manager.

## Reproduce

```sh
npm test
npm run evaluate
npm run check:public
npm run readiness
```

Readiness exits **2** while the funding gate is blocked and **1** for invalid
invocations. It reserves **0** for a future verified ready implementation. It
does not create a ledger, start sessions, sign, submit jobs, buy or sell.

Optional read-only checks on the intended host:

```sh
npm run readiness -- --feed --acp-config /private/worker.json
```

`--feed` uses exact `GHOST_BASE_POOLS` and public market reads. `--acp-config`
checks official CLI identity and offering configuration. No credentials belong
in that JSON. Passing these checks cannot prove hosting, signer availability,
completed jobs or live trading. WAIT can be normal market behavior; it does not
justify weakening checks.

## Evidence and remaining gates

| Requirement | Result | Evidence / remaining work |
| --- | --- | --- |
| Base meme identity and two closed-candle strategies | Local verification passed | Feed, strategy and scanner tests; exact pool selection required |
| Risk checks and modeled accounting | Local verification passed | Pause/resume, midnight gaps, costs, invalid state and recovery regressions |
| ACP request through report delivery | Local integration passed | Child-process CLI fixture, actual scanner, persistent journal and duplicate tests |
| Automated suite | 103 tests passed | Node 24, synthetic responses and local storage; no real money |
| Declared evaluations | 20 synthetic cases | Declared behavior, not profitability |
| Live market coverage | Partial | One earlier bounded pool probe; stale/concentrated evidence prevented entry |
| Continuous hosted operation | Unverified | Console showed No Instance; runtime, persistent disk and restart need testing |
| Authenticated ACP job and settlement | Unverified | Controlled provider/buyer/evaluator integration required |
| Real token swaps and exits | Not implemented | Constrained executor, receipt and wallet reconciliation, real position management required |
| Real capital/signing policy | Unconfigured | Owner-approved wallet scope, assets, capital, fee and loss limits required |
| Funding alone starts the bot | False | Funding does not implement code or deploy the worker |

The Console hosting review showed **20 USDC/month** on
2026-10-14. No hosting purchase was made. Payment alone would not install this
worker or supply its missing trading integration.

## Defects fixed

- Invalid market configuration no longer prevents status or pause.
- Resuming a paused session preserves its unexpired deadline and cumulative spend.
- UTC rollover carries the higher of the previous complete equity mark and the
  current mark, so overnight gaps are not erased. This is conservative observed
  equity, not an exact midnight price.
- Recovery validates timestamps, booleans, risk enums, orders, positions and the
  accounting identity: cash plus open cost equals initial cash plus realized P&L.
  Older v3 records without `lastEquity` use their recorded peak conservatively.
  Invalid records are rejected instead of reset to a new bankroll.
- Complete holder lists must account for supply within rounding tolerance. Valid
  top-ten lists for larger holder counts remain supported.
- Per-address tax changes, modifiable anti-whale rules, cooldowns, reclaimable
  ownership, external calls, self-destruct, whitelist and anti-whale restrictions
  are preserved and checked. Missing required evidence waits; known risk blocks.
- New modeled entries and later fills require target proceeds to exceed modeled
  entry and exit costs. Research's 2R target is a **gross price-distance target**,
  not a promise of 2R net returns. Stops and costs remain estimates.

Eight added regression tests first failed on the prior code. The fixes then passed
them, additional recovery/readiness coverage and the full suite.

## Remaining trading integration

Inspected ACP CLI **1.0.40**, commit
`9d2be827cc19e4ea2cecfff3896398607537ea3e`, and SDK **0.1.15**. The command requests
explicit chains, tokens, an amount and slippage, but its client signs
backend-provided actions without locally enforcing all those economic bounds.
It exposes no durable resume/idempotency contract or guaranteed confirmed-fill
schema. An interrupted invocation can leave an uncertain result. GhOsT therefore
does not call `acp trade` automatically. CLI success or a transaction hash alone
is not a verified position or working exit.

The remaining executor must validate exact chain, token, router, recipient,
input, minimum output, approvals and fee limits before signing; persist a
transaction identity before broadcast; reconcile confirmed receipts and balances;
and manage sells across restarts, outages and uncertain outcomes. Then it needs
controlled integration evidence with the configured host and signer. Research
scores, test counts and profile text cannot replace those requirements.

Primary contracts:

- [Pinned official trading source](https://github.com/Virtual-Protocol/acp-cli/blob/9d2be827cc19e4ea2cecfff3896398607537ea3e/src/commands/trade.ts)
- [Pinned signer/receipt adapter](https://github.com/Virtual-Protocol/acp-node-v2/blob/392dcc6eb17a6884c214c21aff31afa1b99f45ae/src/providers/evm/privyAlchemyEvmProviderAdapter.ts)
- [GoPlus response definitions](https://docs.gopluslabs.io/reference/response-details)
- [Research worker setup and acceptance](ACP_WORKER.md)
