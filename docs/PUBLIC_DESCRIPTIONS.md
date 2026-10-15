# GhOsT v0.5 public descriptions

Copy prepared for review on 2026-10-14. Repository About settings and external
Virtuals project/job descriptions are not changed by merging a documentation PR.
Apply the matching text separately after review; do not mark the ACP offering
active until its delivery and settlement checks are complete.

## GitHub About

GhOsT v0.5: hosted Base meme research, two 5-minute strategies, simulation and a user-run Uniswap v3 live executor. Trading needs a configured wallet and running host. Funded operation unverified; hosted customer trading not deployed; ACP delivery pending.

This replaces the outdated project-wide claim that hosting and live trading are
both pending. The published portal and implemented executor do not establish
managed trading, authenticated ACP delivery or customer traction.

## Project overview / business introduction

GhOsT v0.5 brings Base meme-market data, token-risk screening and two explicit
closed 5-minute strategies into one inspectable research workflow. Traders can
compare volume breakout and trend pullback, see why setups pass or fail, and
model outcomes with persistent simulated capital. The public portal offers
hosted live-feed research and setup guidance.

For users running their own wallet and host, the separate live executor implements
real ERC20 approvals, swaps, receipt accounting and monitored exits in canonical
Base Uniswap v3 pools quoted in USDC or WETH. Funded mainnet and fork-based
end-to-end operation remain unverified; the published suite has no live-executor
tests. Hosted unattended customer trading is not deployed or verified. Token
screening and execution controls cannot guarantee sellability, fills or returns.

GhOsT is seeking research feedback, design partners and infrastructure/security
collaboration. Next milestones include live-executor validation, authenticated
ACP delivery and settlement, forward strategy evaluation, measured service costs
and actual user feedback. No customer numbers, revenue, sponsorship, investment
returns or credit approval are established.

## ACP job description

Use the research-only [marketplace description](MEME_OFFERING.md), not the full
project's live-execution description. The staged `ghost_base_meme_scan` job
evaluates one caller-selected Base pool using volume-breakout or trend-pullback
rules and returns structured PASS/WAIT/BLOCKED research. It requests no trading
principal or wallet access and performs no token swaps. Its configured $0.01 fee
and 10-minute delivery window are proposed service terms, not evidence of sales.
The offering remains hidden pending hosted authenticated delivery/settlement tests.

## Developer-credit evidence

Use [CREDIT_REVIEW.md](CREDIT_REVIEW.md) and [REVIEW_GUIDE.md](REVIEW_GUIDE.md).
Optional inference credits would support explanation-quality, latency and usage
evaluation. They are not required by the deterministic runner or live executor,
do not provide hosting/trading capital, and have not been confirmed approved.

## Metadata scope

In [agent-card.json](../agent-card.json), `liveOrders: false` refers only to the
default research/simulation runtime. `liveExecutorImplemented: true` and
`tokenTradeSigning: true` describe the separate explicit live command; neither
asserts verified funded operation. `fundingReady: false` and `readinessCommand`
refer to staged ACP readiness, not a check of any user's wallet. Use
`liveReadinessCommand` for that separate read-only check.

[source-provenance.json](../source-provenance.json) records a historical source
import; its original runtime status is not the current deployment status. Current
capability and validation boundaries are in [READINESS.md](READINESS.md).

[Public portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/) ·
[Live operating guide](LIVE.md) · [Business overview](BUSINESS_OVERVIEW.md) ·
[Security limitations](../SECURITY.md)
