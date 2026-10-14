# Developer inference-credit review — GhOsT v0.5

GhOsT is an early Base meme-coin research, simulation and user-run live-execution
project for traders, research teams and Virtuals ecosystem builders. It evaluates
closed 5-minute volume-breakout and trend-pullback strategies, screens pool/token
risk, records simulated orders and generates bounded evidence-linked explanations.

The [public portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/) provides
hosted live-feed research. The continuous local research/simulation runner operates
without credits, a wallet or funds. The separate [live executor](LIVE.md) implements
real approvals, swaps, receipt/balance reconciliation and exits for canonical Base
Uniswap v3 pools quoted in USDC or WETH. Live trading requires a separately
configured wallet and running user-managed host. Funded mainnet and fork-based
end-to-end operation remain unverified; hosted unattended customer trading is not
deployed or verified. The ACP research worker is implemented, but authenticated
hosted delivery/settlement remain unverified and its offering stays hidden.

## Reviewable evidence

- [Public source](https://github.com/xx10gboyxx-source/ghost-virtuals-agent) and
  [Virtuals project](https://app.virtuals.io/virtuals/143409).
- [Reviewer guide](REVIEW_GUIDE.md) with installation and offline reproduction commands.
- [Evaluation record](EVALUATION.md): 136 automated tests and 20 synthetic
  evaluation cases reproduced from the public checkout. The published suite does
  not exercise the live executor; it is not funded-execution or profitability evidence.
- [Operating guide](OPERATING.md), [live guide](LIVE.md),
  [deployment status](READINESS.md) and [business overview](BUSINESS_OVERVIEW.md).

## Intended use of requested credits

Credits would support optional Virtuals-model explanation evaluation: fidelity to
recorded evidence, handling of uncertainty and missing data, rejected-setup
explanations, latency and measured credit consumption. Start with the recorded
synthetic cases and compare outputs against their known evidence; any later
live-data study must retain original observations and rejected results.

Inference is disabled by default. It can explain sanitized evidence but cannot
change signals, budgets, permissions or orders. Credits are not a prerequisite for
the deterministic research runner or the separately configured live executor and
do not supply trading funds or a persistent host. No xAI Grok integration is claimed.

No real-provider model-quality evaluation, customer adoption, operating revenue,
sponsorship, investment returns or credit approval has been verified. Public
deployment and test counts do not establish those outcomes or program eligibility.

Please review the implementation and reproducible evidence manually if automatic
screening cannot assess this early project. Credit approval remains the program's
decision. This document is review material, not evidence of a submitted or approved
application.
