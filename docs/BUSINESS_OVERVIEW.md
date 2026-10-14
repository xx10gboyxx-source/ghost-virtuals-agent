# GhOsT · Base meme market intelligence

**Research the token. Explain the risk. Test the strategy.**

GhOsT is an early software project building explainable Base meme-coin research
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

Version 0.5 also provides a [public research portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/) and a [user-run live execution adapter](LIVE.md) for canonical Base Uniswap v3 USDC/WETH pools. Users configure their own host and wallet. Real approvals, swaps, receipt accounting and exits are implemented; funded mainnet performance is not established.

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

The first commercial milestone is a working research service. Its economics need
measurement: completed-job latency, provider availability, failure resolution,
hosting cost per job and optional inference cost. Any paid subscription or licensing offer remains exploratory. The live runner source is available now.

## Evidence available today

- A continuous wallet-free research runner, automatic pool discovery, both
  strategy reports and a persistent simulation ledger. Run it with `npm start`;
  no deposit, API key or inference credits are required.
- A persistent ACP worker with request validation, duplicate protection, deadline
  checks and recovery records; its external CLI contract is documented.
- 161 automated tests and 20 declared synthetic evaluation cases. These establish
  tested software behavior, not profitability or production reliability.
- One bounded live-market probe and a local restart/outage check. The probe did
  not produce an eligible entry and does not establish broad data coverage.
- Public source, review commands and a read-only live wallet/pool check. See [the review guide](REVIEW_GUIDE.md) and
  [readiness audit](READINESS.md).

No customer adoption, operating revenue, sponsorship, inference-credit approval,
audited returns or performance edge has been verified. Synthetic activity is not
represented as marketplace activity.

## Development milestones

| Milestone | Acceptance evidence | Status |
| --- | --- | --- |
| Reproducible research core | Scanner, strategy, recovery and reporting checks | Implemented and locally tested |
| Hosted research pilot | Authenticated ACP delivery, settlement, restart and outage tests on the intended host | Pending |
| Forward research evaluation | Timestamped pool observations, costs, rejected setups and simulation outcomes | Pending |
| Commercial validation | Real user feedback, completed jobs and measured service costs | Pending |
| Constrained live execution | Reviewed signer policy, bounded transactions, confirmed fills, reconciliation and real exits | Implemented; funded deployment verification pending |

Development support would target hosting/integration work, data validation and
independent security review. No funding amount, valuation, ownership terms or
delivery date is implied. Adding funds does not complete these milestones or
start a user-run live process.

## Boundaries and contact

Screening cannot guarantee sellability or prevent rug pulls. Data may be stale or
incomplete, and simulated costs do not establish executable prices. Live swaps,
real exits and unattended production operation are not available. Optional AI
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
