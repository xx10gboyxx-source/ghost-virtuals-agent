# GhOsT execution status — v0.5

The live Base Uniswap v3 executor is implemented. It signs bounded real approvals
and swaps and implements receipt/wallet reconciliation, persisted positions and
exit monitoring. These are source capabilities; they have not been independently
verified in funded operation. [LIVE.md](LIVE.md) documents the `npm run live` commands.

The public [portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/) is a hosted
research interface and live-runner guide. Users run trading on their own host and
configure their own wallet; no hosted trading account is created by opening the page.

`npm run live -- check ./live-config.json` performs the relevant read-only check for
a selected wallet/pool. `npm run live -- run ./live-config.json` starts actual user-run
execution. The old `npm run readiness` concerns the separate ACP research deployment
and never activates or blocks this live runner.

| Capability | Release evidence |
| --- | --- |
| Public live-feed research | Published research interface; HTML reachability checked, sustained service behavior unverified |
| Two meme strategies and simulation | 136 automated tests and 20 synthetic evaluation cases |
| Live signing and receipt reconciliation | Implemented in `live/base-broker.mjs`; no published automated live tests |
| Persisted live positions, exits and recovery | Implemented in `live/agent.mjs`; live lifecycle tests absent from published suite |
| Funded mainnet or fork trading | Not verified in this release |
| Hosted unattended customer trading | Not deployed; users run their own Node24 host |
| Authenticated ACP job delivery/settlement | Separate worker remains unverified and offering hidden |

Adding money alone does not start a program. A configured, running live command
can trade eligible signals; neither inference credits nor an ACP subscription is
required by that command. Read the supported route and recovery details in
[LIVE.md](LIVE.md), the [security limits](../SECURITY.md), and the
[reproducible evidence](EVALUATION.md). No profitability, adoption, sponsorship or
credit approval follows from these capabilities or from portal deployment.
