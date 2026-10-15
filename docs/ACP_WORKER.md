# GhOsT ACP worker: deployment and verification

## Current state

The runnable worker is implemented in `agent/acp-cli.mjs` and
`agent/acp-worker.mjs`. It serves the existing `ghost_base_meme_scan` research
offering through official ACP CLI **1.0.40**. It does not buy or sell tokens.
The scanner continues to evaluate Base mainnet market data; an ACP test job can
use Base Sepolia settlement without changing the market being researched.

Local verification covers a complete simulated request, fee proposal, funding
notification, real strategy evaluation and JSON delivery through a child-process
CLI fixture. These are **not authenticated ACP jobs or marketplace activity**.
No hosted ACP worker, ACP signer installation, real escrow settlement or real delivery
has been verified. Keep the offering hidden until a controlled integration test
and host restart test pass.

This ACP status does not describe the separate [hosted research portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/)
or the implemented [user-run live executor](LIVE.md). Neither portal availability
nor a live swap establishes ACP job delivery or settlement.

On 2026-10-14 the Virtuals Console payment review showed monthly hosting of
**20 USDC** per month. No payment
was made. Console runtime compatibility (Node 24, persistent disk, native CLI
keychain and supervision) still needs verification on an actual instance.
Inference credits do not establish that ACP hosting or job delivery is active.

## Released interface

The inspected npm release and official source use:

```text
acp events listen --json
acp job list --json
acp job history --job-id ID --chain-id CHAIN --json
acp provider set-budget --job-id ID --amount 0.01 --chain-id CHAIN --json
acp provider submit --job-id ID --deliverable JSON --chain-id CHAIN --json
```

The website's newer `acp serve` handler guide differs from released CLI 1.0.40.
This worker uses only commands confirmed in the release source. Upgrade the CLI
only after validating its schemas and lifecycle against these tests.

## Prepare an authorized host

Use Node.js 24+, a persistent private disk, a functioning OS keychain and outbound
access to Virtuals, GeckoTerminal and GoPlus. Run as a dedicated unprivileged user.
Install the reviewed CLI from the official npm registry:

```sh
npm install -g @virtuals-protocol/acp-cli@1.0.40
node --version
acp --version
npm test
npm run check:public
```

Authenticate and select the intended existing identity using the CLI's normal
browser flow on that host. Never paste credentials into chat or repository files.
`IS_TESTNET=true` selects the CLI's separate testnet configuration. A testnet
identity must be set up separately; the mainnet GhOsT UUID is not a testnet identity.
Signer approval is a separate wallet-access step the owner must review.
Do not silently create an identity, signer, new offering or trading permission.

Create a private configuration outside the checkout (mode 0600):

```json
{
  "agentId": "REPLACE_WITH_THE_AUTHENTICATED_AGENT_UUID",
  "chainId": 84532,
  "statePath": "/absolute/private/path/ghost-acp.sqlite"
}
```

For an approved mainnet deployment, the existing GhOsT agent UUID is
`01a0ddd4-4982-70d0-b660-0ec5cccd0e12` and settlement chain is `8453`.
Use a separate journal for each agent and network. The journal binds both and
refuses reuse for a different identity. Preserve it across deployments.

```sh
node agent/acp-cli.mjs preflight /private/worker.json
node agent/acp-cli.mjs run /private/worker.json
node agent/acp-cli.mjs status /private/worker.json
```

Preflight is read-only. It checks the CLI version, active identity and exactly one
fixed-price $0.01/10-minute offering with no requested funds or subscriptions.
It does **not** prove signer availability or successful transaction delivery.
Run mode proposes fees and submits funded research jobs using the approved signer.
Those ACP operations can incur chain/network costs; no spending estimate is claimed.

The supplied `deploy/ghost-acp.service` is a **user-service template** for a
compatible Linux host with the checkout at `~/ghost-virtuals-agent` and private
config at `~/.config/ghost-acp/worker.json`. Confirm that the service can reach the
same unlocked keychain as the CLI before enabling it. A managed Console may use a
different supervisor; do not claim this template is installed there.

## Acceptance before public activation

1. Keep the offering hidden. Verify the configured runtime and authenticated
   identity with the read-only preflight.
2. On Base Sepolia, use a separately authenticated buyer to create a controlled
   job for the test provider's `ghost_base_meme_scan` offering. Use the official
   `client create-job --offering-name` flow, then explicitly approve test funding.
3. Verify the provider proposes exactly 0.01 test USDC, receives the funded event,
   and submits a JSON report for the requested pool. WAIT/BLOCKED are valid
   research outcomes; a feed outage must not be fabricated as successful analysis.
4. Verify evaluator completion/rejection and recorded platform status. A local
   `submitted` row alone is not proof of settlement or a completed ACP job.
5. Restart the worker with the same journal. Verify no duplicate fee proposal or
   submission. Test an invalid request and a provider outage before public use.
6. Verify the mainnet host and signer separately, then enable the public offering
   only after a controlled end-to-end delivery succeeds on the intended environment.

## Operational bounds and recovery

- One active process lease per journal; a missed lease blocks signing. Child
  commands use argv without a shell, have 60-second timeouts and 2 MiB output caps.
- Exact agent/chain/offer name, sender, requirements and 0.01 USDC fee checks;
  unknown fields, principal requests, subscriptions and nonstandard hooks fail closed.
- At most 16 outstanding jobs and 20 new fee proposals/hour; 2,000 journal rows
  maximum. Review/archive only after checking settlement; do not delete records
  merely to clear capacity or uncertain actions.
- Shared 8 public-data requests/minute and bounded pool caches; 429 backoff is
  global. Three scan attempts with a 60-second cooldown, not unlimited retries.
- Fresh list/history reads before signed actions; deadlines and report freshness
  are checked again before submission. Events trigger bounded catch-up polling.
- Signed-action intent and exact deliverable are stored first. Timeout, crash or
  ambiguous response enters `review`; **no blind signed retry** occurs.
- A missing job is reconciled against history. `deadline_passed` only means the
  local expiry passed; settlement remains unverified unless the platform confirms it.

For `review`, stop accepting additional work if capacity is affected, inspect the
official job history, and resolve with the client/platform. There is no provider
refund/reject command in this CLI contract. The evaluator controls completion or
rejection. Do not promise automatic refunds or manually mark a job successful.

## Primary references

- [CLI source and migration](https://github.com/Virtual-Protocol/acp-cli/blob/main/migration.md)
- [Events](https://github.com/Virtual-Protocol/acp-cli/blob/main/src/commands/events.ts)
- [Job commands](https://github.com/Virtual-Protocol/acp-cli/blob/main/src/commands/job.ts)
- [Provider commands](https://github.com/Virtual-Protocol/acp-cli/blob/main/src/commands/provider.ts)
- [SDK event types](https://github.com/Virtual-Protocol/acp-node-v2/blob/main/src/events/types.ts)
- [Headless requirements](https://github.com/Virtual-Protocol/acp-cli/blob/main/docs/headless-deployment.md)

Source inspected: CLI 1.0.40, commit `9d2be827cc19e4ea2cecfff3896398607537ea3e`;
SDK 0.1.15, commit `392dcc6eb17a6884c214c21aff31afa1b99f45ae`.
