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
| Complete automated suite | 218 automated tests, including 82 live execution tests, plus 20 synthetic evaluation cases |
| Two meme strategies and simulation | Research, screening, simulation and recovery cases remain in the complete suite |
| Live signing and receipt reconciliation | 60 broker cases with real viem signing/encoding and deterministic RPC fixtures |
| Persisted live positions, exits and recovery | 22 agent cases with the real broker and SQLite journal |
| Base-fork end-to-end trading | Failed/unverified: Anvil approval receipt omits required `l1Fee`; broker returns `L1_FEE_UNKNOWN` |
| Funded mainnet trading | Not verified in this release |
| Hosted unattended customer trading | Not deployed; users run their own Node24 host |
| Authenticated ACP job delivery/settlement | Separate worker remains unverified and offering hidden |

Adding money alone does not start a program. A configured, running live command
can trade eligible signals; neither inference credits nor an ACP subscription is
required by that command. Read the supported route and recovery details in
[LIVE.md](LIVE.md), the [security limits](../SECURITY.md), and the
[reproducible evidence](EVALUATION.md). No profitability, adoption, sponsorship or
credit approval follows from these capabilities or from portal deployment.
