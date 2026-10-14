# GhOsT · Virtuals Agent

**Clarity before the trade.** A public, runnable research prototype for disciplined
market evaluation, persistent simulation state, and explainable agent reports.

[Virtuals project](https://app.virtuals.io/virtuals/143409) ·
[Creator updates](https://x.com/PulseLayerAI) ·
[Agent evidence](docs/AGENT.md) · [Evaluation](docs/EVALUATION.md)

## Current status

**Early prototype — not deployed to a Virtuals host; no autonomous live trading.**
The repository contains working simulation code, an offline demonstration,
automated tests, and an optional Virtuals Compute reporting client. Hosted runtime,
real-provider inference, live market-data integration and paid ACP services have
not been validated for this standalone package. No win rate or investment return
is claimed. The GHOST Base token and this BTC simulation are different things.

## Run the evidence yourself

Requires Node.js 24 or newer. No npm dependencies, account, API key or funds are
needed for these commands:

```sh
git clone https://github.com/xx10gboyxx-source/ghost-virtuals-agent.git
cd ghost-virtuals-agent
npm test
npm run demo
npm run check:public
```

The demo creates a temporary SQLite ledger, starts a simulation against synthetic
BTC outcome-contract books, records an entry, waits for a later book to simulate a
fill, evaluates an exit, and blocks same-window re-entry. It removes its temporary
ledger afterward. Output is labelled `SYNTHETIC_OFFLINE_DEMO`; no network or model
calls are made. A committed example is in [examples/demo-output.json](examples/demo-output.json).

## What the agent does

| Component | Implemented behavior | Evidence |
| --- | --- | --- |
| Observation | Read public BTC/BRTI 15-minute market terms and books through a bounded feed adapter | `server/polymarket-us-feed.mjs`; live connectivity unverified |
| Evaluation | Deterministic entry, freshness, fee, budget and exit checks | `server/polymarket-crypto-engine.mjs`, operator tests |
| Memory | SQLite simulation ledger, fixed session deadline, durable worker lease | `operator.mjs`, restart/concurrency tests |
| Reporting | Structured observation and PASS/WAIT/BLOCKED explanations | `agent/reporter.mjs`, reporting tests |
| Optional inference | One bounded, read-only Virtuals Compute explanation per explicit report request | `agent/reporter.mjs`; provider responses mocked in tests |

This is a constrained agent workflow: observe → evaluate → retain state → explain.
The deterministic engine decides simulation behavior. AI commentary cannot submit
orders, change risk limits, extend sessions or access wallet signers. It is not a
general-purpose autonomous agent or a hosted ACP job service.

## Strategy and operating limits

The included `grok_high_prob` strategy is GhOsT's existing deterministic experiment.
**Its name does not mean an xAI Grok integration or a calibrated probability.**
It evaluates YES/UP and NO/DOWN offers in eligible BTC 15-minute outcome contracts,
using an initial offer band of $0.55–$0.85. Do not apply this band to GHOST or spot
coin prices. The broader Base-market / 5-minute-confirmation product is a roadmap
item, not functionality demonstrated by this package.

Initial simulated limits: $50 ledger; $5 maximum stake; $20 maximum exposure;
three positions; three pending orders; $10 rolling loss budget; $50 session spend.
Books must be fresh within 15 seconds. New entries require more than 90 seconds
remaining. Exit checks use +15% net take-profit, −20% net stop, or 45 seconds to
expiry; fills and exits are never assumed without eligible later depth. Official
settlement is required where applicable. These settings are experimental, not a
recommendation.

```sh
node operator.mjs status ./state/ghost-grok.sqlite
node operator.mjs start ./state/ghost-grok.sqlite
node operator.mjs run ./state/ghost-grok.sqlite
node operator.mjs pause ./state/ghost-grok.sqlite
npm run report -- ./state/ghost-grok.sqlite
```

`status` and `report` do not fetch markets. `tick` and `run` use the public feed.
`start` explicitly begins a four-hour simulation; `run` never starts or renews it.
`pause` cancels pending buys and stops new entries. Existing positions still need
a running worker for exit/settlement checks. Use one private persistent database
path. Never publish runtime state. This repository does not deploy a host.

## Optional AI explanation

Inference is disabled by default. After obtaining approved Virtuals Compute
access, configure the process privately with `VIRTUALS_API_KEY`, a current
`VIRTUALS_MODEL`, and `GHOST_ENABLE_INFERENCE=true`, then request one report. The
model ID must come from the current Virtuals model list. Calls may consume credits;
there are no automatic retries, purchases or top-ups. See
[docs/INFERENCE.md](docs/INFERENCE.md) for the exact boundary and remaining tests.

## Build with GhOsT

Open to reproducible bug reports, research comparisons, pilot feedback and
collaboration with traders, companies, and Virtuals/Base builders. Use Issues for
non-sensitive technical discussion or contact [@PulseLayerAI](https://x.com/PulseLayerAI).
Never post keys, private logs, account identifiers or wallet seed phrases.

Source is public for inspection. No open-source license is granted at this stage;
see [NOTICE](NOTICE). This standalone repository does not publish the main private
GhOsT application or its customer data. Public code and tests support review; they
do not guarantee credit-program acceptance.
