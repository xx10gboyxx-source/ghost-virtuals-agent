# GhOsT execution status — v0.5

The live Base Uniswap v3 executor is implemented. It signs bounded real approvals
and swaps, reconciles receipts and wallet balances, and monitors positions through
restarts. [LIVE.md](LIVE.md) documents the actual `npm run live` commands.

The public [portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/) is a hosted
research interface and live-runner guide. Users run trading on their own host and
configure their own wallet; no hosted trading account is created by opening the page.

`npm run live -- check ./live-config.json` performs the relevant read-only check for
a selected wallet/pool. `npm run live -- run ./live-config.json` starts actual user-run
execution. The old `npm run readiness` concerns the separate ACP research deployment
and never activates or blocks this live runner.

| Capability | Release evidence |
| --- | --- |
| Public live-feed research | Deployed scan API and mobile interface |
| Two meme strategies and simulation | Existing automated suite and 20 synthetic evaluations |
| Live signing and receipt reconciliation | Deterministic RPC tests with real viem signing/encoding |
| Persisted live positions, exits and recovery | Real SQLite lifecycle tests with injected broker outcomes |
| Funded mainnet or fork trading | Not verified in this release |
| Hosted unattended customer trading | Not deployed; users run their own Node24 host |
| Authenticated ACP job delivery/settlement | Separate worker remains unverified and offering hidden |

Adding money alone does not start a program. A configured, running live command
can trade eligible signals; neither inference credits nor an ACP subscription is
required by that command. Read the supported route and recovery details in LIVE.md.
