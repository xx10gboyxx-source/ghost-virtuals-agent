# GhOsT development roadmap

Version 0.5 provides public live-feed research and a user-run Base Uniswap v3 live
executor. See [LIVE.md](LIVE.md) for the supported routes, commands and limits.

Implemented: two closed-five-minute meme strategies, public data/security adapters,
persistent simulation and reporting, a hosted research portal, exact ERC20 approvals,
real swap signing, receipt/balance reconciliation and durable live exit monitoring.

Next validation work:

1. Extend the published live-executor tests for the [remaining execution gaps](LIVE_EXECUTION_TESTS.md#remaining-execution-gaps)
   and obtain independent signer/recovery security review.
2. Resolve the fork environment's missing L1 receipt fees without weakening production
   reconciliation, then exercise a full route on a Base fork and a separately authorized owner-run funded deployment, recording
   real receipts, balances, recovery outcomes and measured gas.
3. Collect forward strategy evidence and rejected setups without presenting synthetic
   results as returns.
4. Validate authenticated ACP research-job delivery, settlement and restart behavior
   before publishing that paid job.
5. Measure public portal provider capacity, uptime, user feedback and operating costs.
6. Validate demand, completed jobs and service economics before claiming commercial
   traction. Any future hosted customer trading needs separate customer isolation,
   credential protection, supervision and recovery validation; it is not deployed.

The live runner does not require completion of the ACP milestones to operate.
No profitability, funding, sponsorship or completion date is claimed.
