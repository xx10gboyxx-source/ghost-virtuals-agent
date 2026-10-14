# GhOsT · Base Meme Market Intelligence

[![Verify public agent](https://github.com/xx10gboyxx-source/ghost-virtuals-agent/actions/workflows/verify.yml/badge.svg)](https://github.com/xx10gboyxx-source/ghost-virtuals-agent/actions/workflows/verify.yml)

**Research the token. Explain the risk. Test the strategy.**
GhOsT turns market and token-security data into structured Base meme-coin research
for traders, research teams and AI-agent builders. It evaluates caller-selected
pools, explains why a setup passes or fails, and models strategy behavior before
real capital is involved.

The current product is a working local research and simulation prototype. Its
ACP research worker is implemented; hosted customer delivery and live trading
are not active. **Adding funds alone will not start a trading bot.**

[Virtuals project](https://app.virtuals.io/virtuals/143409) ·
[Creator](https://x.com/PulseLayerAI) · [Business overview](docs/BUSINESS_OVERVIEW.md) ·
[Reviewer guide](docs/REVIEW_GUIDE.md) · [Operating readiness](docs/READINESS.md)

## Who it serves

| Audience | Intended value | Available evidence |
| --- | --- | --- |
| Traders | Compare two strategies with explicit rejection reasons | Closed 5-minute rules, token-risk checks and local simulation |
| Research teams and businesses | Inspect consistent, timestamped reports | Structured JSON, reproducible cases and public source |
| Virtuals / AI-agent builders | Integrate a bounded Base research task | Scanner and ACP worker; hosted delivery still needs validation |
| Investors and ecosystem partners | Assess an inspectable early product | Test evidence and explicit launch gates; no validated revenue or returns |

## What works

- **Volume breakout:** closed 5-minute candle breaks the prior 20-candle high,
  with at least 2× average volume and an upward EMA trend; excessive chase is rejected.
- **Trend pullback:** bullish recovery near EMA20, with EMA20 above EMA50,
  RSI between 45 and 68, and at least 1.2× average volume.
- **Token-risk screening:** Base contract identity, supplied GoPlus honeypot,
  sell restriction, mint/proxy/owner-control flags, taxes and holder concentration.
  Unknown or incomplete evidence prevents entry.
- **Pool checks:** fresh quote, at least $100k reported liquidity, $50k daily
  volume, 48-hour pool age, complete candle history and quote/close consistency.
- **Paper execution:** later-quote entries and exits, cost-aware sizing, persisted
  SQLite state, stop/target logic, session deadline and loss locks.
- **Research reports:** bounded `explain-wait` and `session-review` tasks with
  evidence IDs and optional read-only Virtuals Compute explanations.

These are experimental rules, not a proven investment edge. Thresholds are research
settings. “Meme coin” is a user-selected token category; the software cannot infer
that identity from a ticker. An operator must select exact Base pool contracts.

## Current status

**Research and simulation only. Not deployed for unattended operation.** The package has no
live swap executor or real exit manager. The ACP job worker uses an external
official CLI signer for provider actions, but no hosted paid service is active. One live Base pool's
market/security responses and a bounded local restart/outage smoke test have been
checked. A hosted four-hour run, actual trade fills, real inference quality and
profitability remain unvalidated. [Launch status and commands](docs/HOSTING.md).
Adding money or compute credits does not activate trading. Run `npm run readiness`
for the read-only funding gate (currently blocked, exit 2). The
[operating-readiness audit](docs/READINESS.md) records verified behavior and the
remaining execution, hosting, signer and real integration requirements.

The active commands use **Base spot tokens**, not BTC 15-minute outcome contracts.
Two old `server/polymarket-*` files remain solely as historical source excerpts;
they are not imported by the v0.3 operator. Old BTC ledgers are explicitly rejected.
No xAI Grok connection is claimed. The GHOST project token is not automatically a
trading target, and the project does not promise returns to token holders.

## Run the evidence

Node.js 24+, no dependencies, wallet, API key or funds required:

```sh
git clone https://github.com/xx10gboyxx-source/ghost-virtuals-agent.git
cd ghost-virtuals-agent
npm test
npm run demo
npm run agent:demo
npm run evaluate
npm run check:public
```

The current suite has **103 tests** and **20 synthetic evaluation cases** (10 agent
reporting cases and 10 meme-market screening cases). These test software behavior,
not investment performance. The offline demo follows a synthetic token entry and
exit; all costs and results are simulated. [Evaluation details](docs/EVALUATION.md).

## Meme-scan job definition

`ghost_base_meme_scan` is the staged EconomyOS research offering. Its matching
one-shot JSON command is `node agent/meme-scan.mjs < request.json`. It accepts a
Base `poolAddress` and optional `strategy`, returning a PASS/WAIT/BLOCKED research
report with evidence timestamps. A persistent ACP event worker now connects this
scanner to the reviewed official CLI, with request validation, fixed-fee checks,
duplicate protection and recovery records. **Hosting and authenticated delivery
remain unverified**, and the offering is hidden pending activation.
[Input/output](docs/MEME_OFFERING.md) · [Worker setup and acceptance](docs/ACP_WORKER.md).

## Run a local paper session

Set `GHOST_BASE_POOLS` in the process environment to one or two full Base pool
contract addresses, separated by commas. Do not use a token address in place of a
pool address. Only the pool's base-token side is supported. The empty default
selects no assets and returns WAIT. No account or wallet is connected.

```sh
node operator.mjs status ./state/ghost-meme.sqlite
node operator.mjs start ./state/ghost-meme.sqlite volume-breakout
node operator.mjs run ./state/ghost-meme.sqlite
node operator.mjs pause ./state/ghost-meme.sqlite
npm run agent -- session-review ./state/ghost-meme.sqlite
```

To research `trend-pullback`, create a separate new paper database with that
strategy argument. The strategy is saved on first creation. `run` resumes the
stored strategy; it never starts or renews a session. `start` after a pause within
the same session preserves its original deadline and cumulative spend. Keep private runtime databases
outside public source. A host must stay running for checks; this repository does
not install or deploy one.

Initial paper capital is $50. Modeled per-entry risk is 0.5% of observed equity;
maximum buy notional including proportional costs is $5, plus $0.02 estimated gas.
Only one position is modeled at a time. A four-hour session has a $50 cumulative
spend limit. A $1.50 UTC-day observed-equity loss or $5 observed-equity drawdown
locks new entries; restarting a session does not clear the lock.

Stop distance is the greater of 2× ATR14 and 3%, capped at 10%; target is 2× that
price distance. Modeled costs include 0.3% fee, 1% slippage, supplied token taxes
and $0.02 gas per fill. Entries and later fills reject targets that would lose money
after those modeled costs. The 2R target describes gross price distance. Stops request a later simulated sale and do not guarantee
price or cap loss. Gaps can exceed the modeled risk budget. Pending buys expire
after three minutes. Pause cancels pending buys; an active worker is still needed
for existing position checks. Unknown sale evidence keeps positions unresolved.

## Data and model boundaries

The unsigned feed reads selected Base pools and closed 5-minute OHLCV from
GeckoTerminal, and token-risk data from GoPlus. It uses fixed origins, response
limits, deadlines, caches, a per-process eight-request/minute budget and 429
cooldowns. It makes no paid fallback requests. Provider limits can change.

Quote timestamps describe retrieval, not an independently authenticated trade.
Security reports may be incomplete, wrong or stale; screening cannot guarantee
sellability or prevent rug pulls. Holder concentration includes reported LP/burn
addresses conservatively. A missing required flag returns WAIT. Actual liquidity,
route-level price impact, MEV, market manipulation and wallet reconciliation are
not modeled reliably. This version requires conventional 20-byte pool addresses.

AI is disabled by default. Optional Virtuals inference can explain sanitized
recorded evidence but cannot change orders, budgets or permissions. Model text
remains untrusted even when its citation IDs are valid. [Configuration](docs/INFERENCE.md).

## Work with GhOsT

We are seeking design partners for research workflows, traders for forward
simulation feedback, and infrastructure or strategic partners to help validate
hosted delivery. The [business overview](docs/BUSINESS_OVERVIEW.md) describes
the proposed service, staged pricing and measurable development milestones.
Contact [@PulseLayerAI](https://x.com/PulseLayerAI) or use public Issues for
non-sensitive technical discussion. Investment discussions concern an early
software project; there is no published investment offer, validated trading
performance, confirmed sponsorship or credit approval.

Source is public for inspection under [NOTICE](NOTICE); no open-source license is
granted. The main private GhOsT app and private account data are not included.
