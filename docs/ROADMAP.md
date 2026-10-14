# GhOsT development roadmap

The first launch is a Base meme research service. Live execution is a separate,
unimplemented milestone. Funding, a public profile or a passing software test
does not activate trading.

## Implemented and locally tested

Selected Base pool screening, two closed-candle strategies, bounded public data
adapters, persistent simulation, risk controls, evidence-linked research reports,
a persistent ACP research worker and a read-only funding-readiness check.

One bounded live-market probe and local restart/outage check have been recorded.
They do not establish ongoing coverage or production reliability.

## Next acceptance gates

1. **Hosted research delivery:** verify Node 24, persistent storage, process
   supervision and official CLI authentication on the selected host. Complete a
   controlled ACP job, settlement and restart/outage test before exposing the job.
2. **Forward research evidence:** observe explicitly selected Base pools, record
   provider freshness and gaps, and collect simulation results with modeled costs.
   Preserve rejected setups; do not weaken screening to create activity.
3. **User and service economics:** obtain real pilot feedback and measure delivery
   latency, failure resolution and cost per completed job before revising pricing.
4. **Inference evaluation:** measure real Virtuals-model evidence fidelity,
   uncertainty, latency and credit consumption. AI remains explanation-only.
5. **Live execution design and review:** constrain assets, capital, permissions,
   routers, approvals, price impact and fees. Persist transaction identity before
   broadcast, reconcile confirmed fills and balances, and manage real exits
   through restarts and ambiguous outcomes. Validate the whole path before use.

No completion dates, investment returns or credit approval are promised. See
[READINESS.md](READINESS.md) for current gaps and
[BUSINESS_OVERVIEW.md](BUSINESS_OVERVIEW.md) for partnership opportunities.
