# GhOsT development roadmap

Version 0.5 provides public live-feed research and a user-run Base Uniswap v3 live
executor. See [LIVE.md](LIVE.md) for the supported routes, commands and limits.

Implemented: two closed-five-minute meme strategies, public data/security adapters,
persistent simulation and reporting, a hosted research portal, exact ERC20 approvals,
real swap signing, receipt/balance reconciliation and durable live exit monitoring.

Next validation work:

1. Exercise a full route on a Base fork and an owner-run funded deployment, recording
   real receipts, balances, recovery outcomes and measured gas.
2. Collect forward strategy evidence and rejected setups without presenting synthetic
   results as returns.
3. Validate authenticated ACP research-job delivery, settlement and restart behavior
   before publishing that paid job.
4. Measure public portal provider capacity, user feedback and operating costs.

The live runner does not require completion of the ACP milestones to operate.
No profitability, funding, sponsorship or completion date is claimed.
