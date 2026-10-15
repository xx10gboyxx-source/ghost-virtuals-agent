# GhOsT · Base Meme Market Intelligence

[![Verify public agent](https://github.com/xx10gboyxx-source/ghost-virtuals-agent/actions/workflows/verify.yml/badge.svg)](https://github.com/xx10gboyxx-source/ghost-virtuals-agent/actions/workflows/verify.yml)

**Research Base memes. Compare signals. Run your own trading agent.**
GhOsT turns market and token-security data into structured Base meme-coin research
for traders, research teams and AI-agent builders. It discovers pools for selected
Base tokens, explains why a setup passes or fails, and models strategy behavior
using simulated capital or the separately configured live executor.

**v0.5: [Open the public portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/) · [Run with real assets](docs/LIVE.md).**
The live runner implements real swaps for selected meme tokens in canonical Base
Uniswap v3 pools quoted in USDC or WETH, with exit monitoring and transaction
recovery. The portal provides hosted live-feed research and setup instructions;
live trading requires a separately configured wallet and a running user-managed
host. No funded mainnet or fork-based end-to-end execution has been verified for
this release. Hosted unattended customer trading is not deployed or verified.

**Run GhOsT without money, a wallet, API keys or inference credits.** The continuous
research runner includes automatic pool discovery, both meme
strategies, saved reports and persistent simulated positions.

```sh
git clone https://github.com/xx10gboyxx-source/ghost-virtuals-agent.git
cd ghost-virtuals-agent
npm ci --ignore-scripts
npm start
```

Requires Node.js 24+. The default watchlist is the verified TOSHI Base contract;
GhOsT selects its highest-liquidity supported pool and applies the existing risk
checks. This is a configurable research target, not a recommendation. The first
new ledger starts with **$50 simulated cash**. No deposit is involved. Research
continues every 75 seconds while the process runs, including after the four-hour
simulation entry window ends. [Run and control GhOsT](docs/OPERATING.md).

[Virtuals project](https://app.virtuals.io/virtuals/143409) ·
[Creator](https://x.com/PulseLayerAI) · [Business overview](docs/BUSINESS_OVERVIEW.md) ·
[Reviewer guide](docs/REVIEW_GUIDE.md) · [Run without money](docs/OPERATING.md)

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
- **Live execution:** canonical Base v3 pool verification, exact approvals, bounded swaps,
  durable transaction hashes, receipt/balance reconciliation and real position exits.
  Each user configures and runs their own wallet/host. [Setup](docs/LIVE.md).
- **Simulation:** later-quote entries and exits, cost-aware sizing, persisted
  SQLite state, stop/target logic, session deadline and loss locks.
- **Research reports:** bounded `explain-wait` and `session-review` tasks with
  evidence IDs and optional read-only Virtuals Compute explanations.

These are experimental rules, not a proven investment edge. Thresholds are research
settings. “Meme coin” is a user-selected token category; the software cannot infer
that identity from a ticker. Choose exact Base token contracts for automatic pool discovery, or explicit pool
contracts. The default watchlist does not discover unrelated tokens.

## Current status

**The no-money research and simulation runtime is implemented and tested.** It
runs on a computer or server with Node.js 24 and persistent storage. Cloning this
repository does not provision or keep a host online. The public portal is a separate
hosted research interface, not a host for a user's trading process. The ACP
customer-job worker is separate and remains staged. Live swaps are implemented in
`live/`; use the explicit [live commands](docs/LIVE.md), not `npm start`, to trade.
Use `npm run agent:status` for local state and `npm run agent:reports` for saved
results. `npm run readiness` describes the separate ACP deployment; it does not enable or
block the live runner. Use `npm run live -- check ./live-config.json` for its checks. [Historical host checks](docs/HOSTING.md).

The active commands use **Base spot tokens**, not BTC 15-minute outcome contracts.
Two old `server/polymarket-*` files remain solely as historical source excerpts;
they are not imported by the current operator. Old BTC ledgers are explicitly rejected.
No xAI Grok connection is claimed. The GHOST project token is not automatically a
trading target, and the project does not promise returns to token holders.

## Run the evidence

Node.js 24+ and installed dependencies; offline tests require no wallet, API key or funds:

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

The current checkout reproduces **218 automated tests**, including **82 live execution tests**,
and **20 synthetic evaluation cases** (10 agent reporting cases and 10 meme-market
screening cases). Live cases use real viem signing/encoding and SQLite with
deterministic RPC fixtures. These test software behavior, not funded execution or
investment performance. The Base-fork attempt remains failed/unverified because
Anvil omits required L1 receipt fees. The offline demo follows a synthetic token entry and exit;
all costs and results are simulated. [Evaluation details](docs/EVALUATION.md).

## Meme-scan job definition

`ghost_base_meme_scan` is the staged EconomyOS research offering. Its matching
one-shot JSON command is `node agent/meme-scan.mjs < request.json`. It accepts a
Base `poolAddress` and optional `strategy`, returning a PASS/WAIT/BLOCKED research
report with evidence timestamps. A persistent ACP event worker now connects this
scanner to the reviewed official CLI, with request validation, fixed-fee checks,
duplicate protection and recovery records. **Hosting and authenticated delivery
remain unverified**, and the offering is hidden pending activation.
[Input/output](docs/MEME_OFFERING.md) · [Worker setup and acceptance](docs/ACP_WORKER.md).

## Advanced direct-operator commands

For the older low-level operator only, set `GHOST_BASE_POOLS` in the process environment to one or two full Base pool
contract addresses, separated by commas. Do not use a token address in place of a
pool address. Only the pool's base-token side is supported. The low-level operator has no automatic discovery; its empty default
selects no assets and returns WAIT. Use `npm start` for the new automatic runner. No account or wallet is connected.

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
limits, deadlines, caches and 429 cooldowns. The continuous runtime additionally
persists a shared eight-request/minute budget and provider cooldowns across restarts. It makes no paid fallback requests. Provider limits can change.

Quote timestamps describe retrieval, not an independently authenticated trade.
Security reports may be incomplete, wrong or stale; screening cannot guarantee
sellability or prevent rug pulls. Holder concentration includes reported LP/burn
addresses conservatively. A missing required flag returns WAIT. Actual liquidity,
route-level price impact, MEV and market manipulation are not reliably modeled
by simulation. The separate live adapter implements quote bounds and receipt/wallet
reconciliation; these do not establish funded execution reliability or protection
against all losses. This version requires conventional 20-byte pool addresses.

AI is disabled by default. Optional Virtuals inference can explain sanitized
recorded evidence but cannot change orders, budgets or permissions. Model text
remains untrusted even when its citation IDs are valid. [Configuration](docs/INFERENCE.md).

## Work with GhOsT

We are seeking design partners for research workflows, traders for forward
simulation feedback, and infrastructure or strategic partners to help validate
hosted delivery. The [business overview](docs/BUSINESS_OVERVIEW.md) describes
the proposed service, staged pricing and measurable development milestones.
The [public descriptions](docs/PUBLIC_DESCRIPTIONS.md) provide consistent project
and marketplace copy for review.
Contact [@PulseLayerAI](https://x.com/PulseLayerAI) or use public Issues for
non-sensitive technical discussion. Investment discussions concern an early
software project; there is no published investment offer, validated trading
performance, confirmed sponsorship or credit approval.

Source is public for inspection under [NOTICE](NOTICE); no open-source license is
granted. The main private GhOsT app and private account data are not included.
