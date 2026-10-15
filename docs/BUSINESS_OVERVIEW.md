# GhOsT · Base meme market intelligence

**Research the token. Explain the risk. Test the strategy.**

GhOsT v0.5 is an early software project building explainable Base meme-coin research
for traders, research teams and autonomous-agent workflows. It combines market
structure, volume and token-security evidence into a bounded, timestamped report.
Its purpose is to make screening decisions easier to inspect and reproduce.

## The problem and product

Evaluating a meme token requires checking several sources: the exact pool and
token, liquidity, volume, candle history, holder concentration and token controls.
A price chart alone cannot answer those questions. GhOsT puts these checks in one
reviewable workflow and explains missing data and rejected setups as well as
passing signals.

The implementation supports two explicit strategies on closed 5-minute Base
candles: volume breakout and trend pullback. The continuous runtime discovers supported pools for an exact token watchlist;
the one-shot research job accepts a caller-supplied pool contract. The output is JSON with PASS, WAIT or BLOCKED, a reason, observation
times, metrics and an illustrative price plan when eligible. A passing signal is
research output, not an instruction or authorization to trade.

Version 0.5 also provides a [public research portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/)
and a [user-run live execution adapter](LIVE.md) for selected meme tokens in
canonical Base Uniswap v3 pools quoted in USDC or WETH. Real approvals, swaps,
receipt accounting and exits are implemented. Live trading requires a separately
configured wallet and running user-managed host. Funded mainnet and fork-based
end-to-end operation have not been verified; hosted unattended customer trading
is not deployed or verified.

| Product surface | Available now | Operating boundary |
| --- | --- | --- |
| Public portal | Hosted live-feed research and setup guidance | No customer wallet custody or hosted trade execution |
| Local research runner | Both strategies, automatic pool discovery, saved reports and simulated trades | Node.js 24 host and persistent disk; no funds or credits needed |
| Live executor | Real transaction construction/signing, approvals, swaps, accounting and monitored exits | User-configured wallet, RPC, gas and running host; funded reliability unverified |
| ACP research offering | Scanner and persistent job-worker source | Hidden pending authenticated hosted delivery and settlement validation |

## Customers and collaboration

| Audience | Proposed use | Next validation |
| --- | --- | --- |
| Traders | Review pools and compare strategy decisions | Forward simulation feedback on report usefulness and rejected signals |
| Research teams | Reproduce screening and compare data quality | Review sample reports against their underlying evidence |
| Agent builders | Consume structured Base research through ACP | Controlled authenticated request, delivery and settlement test |
| Infrastructure / strategic partners | Support delivery and research evaluation | Host compatibility, persistent storage and measured operating costs |
| Investors | Evaluate an early inspectable product | Technical diligence and milestone-based discussion; no terms offered here |

## Proposed service model

The staged service is **`ghost_base_meme_scan`**: one selected Base pool, one
strategy, one structured research report. Its configured trial fee is **$0.01 per
job**, with a **10-minute delivery window** and **no trading principal requested**.
The offering remains hidden until a hosted worker and real authenticated delivery
are verified. This is planned pricing, not evidence of sales or sustainable margins.

The next commercial milestone is a validated ACP research-service pilot, separate
from the already published research portal. Its economics need
measurement: completed-job latency, provider availability, failure resolution,
hosting cost per job and optional inference cost. Any paid subscription or licensing offer remains exploratory. The live runner source is available now.

## Evidence available today

- A continuous wallet-free research runner, automatic pool discovery, both
  strategy reports and a persistent simulation ledger. Run it with `npm start`;
  no deposit, API key or inference credits are required.
- A persistent ACP worker with request validation, duplicate protection, deadline
  checks and recovery records; its external CLI contract is documented.
- 218 automated tests, including 82 live execution tests, and 20 synthetic evaluation
  cases reproduced from the public checkout. Coverage includes research/simulation,
  ACP fixtures, real signing and SQLite recovery with deterministic RPC responses.
  It does not establish funded execution, investment performance or production
  reliability. [Evidence scope](EVALUATION.md).
- One bounded live-market probe and a local restart/outage check. The probe did
  not produce an eligible entry and does not establish broad data coverage.
- Public source, review commands and an implemented read-only live wallet/pool
  check; no funded trade follows from the existence of that command. See [the review guide](REVIEW_GUIDE.md) and
  [readiness audit](READINESS.md).

No customer adoption, operating revenue, sponsorship, inference-credit approval,
audited returns or performance edge has been verified. Synthetic activity is not
represented as marketplace activity.

## Development milestones

| Milestone | Acceptance evidence | Status |
| --- | --- | --- |
| Reproducible research core | Scanner, strategy, recovery and reporting checks | Implemented and locally tested |
| Public research portal | Published interface; capacity, uptime and provider behavior require measurement | Published; sustained service validation pending |
| Hosted ACP research pilot | Authenticated ACP delivery, settlement, restart and outage tests on the intended host | Pending; offering hidden |
| Forward research evaluation | Timestamped pool observations, costs, rejected setups and simulation outcomes | Pending |
| Commercial validation | Real user feedback, completed jobs and measured service costs | Pending |
| User-run live execution | Source implements signer policy, bounded transactions, reconciliation and exits | Offline live tests pass; independent security review, complete fork and funded verification pending |
| Unattended hosted customer trading | Customer isolation, credential protection, recovery, supervision and measured reliability | Not deployed or verified |

Development support would target hosting/integration work, data validation and
independent security review. No funding amount, valuation, ownership terms or
delivery date is implied. Adding funds does not complete these milestones or
start a user-run live process.

## Boundaries and contact

Screening cannot guarantee sellability or prevent rug pulls. Data may be stale or
incomplete, and simulated costs do not establish executable prices. Live swaps and
real exits are implemented in the separate user-run adapter; monitored exits need
a running host, usable data, RPC access and gas and cannot guarantee execution.
Local signing keys and journals must be protected by the operator. No independent
security audit or funded execution reliability is established. Optional AI
explanations have no order authority; no xAI Grok integration is claimed.

The GHOST project token is distinct from the research software. This overview
does not offer token-holder revenue, equity, yield or guaranteed returns.
Source is public for inspection under [NOTICE](../NOTICE); an open-source license
has not been granted.

For design partnerships, research pilots or technical diligence, contact
[@PulseLayerAI](https://x.com/PulseLayerAI). Public technical questions can use
the repository's Issues. Never post wallet credentials or private account data.

[Project](https://app.virtuals.io/virtuals/143409) ·
[Source](https://github.com/xx10gboyxx-source/ghost-virtuals-agent) ·
[Service specification](MEME_OFFERING.md) · [Roadmap](ROADMAP.md)
