# GhOsT host evidence and legacy launch checklist

**For the current v0.5 no-money runner, use `npm start` and
[OPERATING.md](OPERATING.md).** The steps below record the earlier low-level
operator integration checks. Funding and inference credits are not required
for the current local research/simulation runtime.

The [public portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/) now provides
hosted research. This historical host check is not a current project-wide claim
that nothing is deployed. The separate [live executor](LIVE.md) is implemented,
but users must configure their own wallet, Node.js 24 host and persistent disk.
Funded mainnet execution remains unverified; unattended hosted customer trading
is not deployed. Authenticated ACP delivery is a separate unresolved deployment.

The repository does not provision a server. A successful feed check is not a
running hosted agent, and a running Virtuals template is not proof that this
repository's worker is installed. No wallet, signer or compute API key is needed
for the deterministic simulation below.

## Historical observations on 2026-10-14

- The live GeckoTerminal pool and OHLCV endpoints and GoPlus token-security
  endpoint returned HTTP 200 for the TOSHI/WETH pool below.
- The feed returned 100 candles and security evidence. GhOsT rejected entry
  because reported holder concentration exceeded its configured threshold.
  Reported daily volume was also below its minimum. The newest returned candle
  began at 10:20 UTC, almost six hours before the check; candle freshness was not
  acceptable for a new signal. Limits were not weakened.
- The bounded local smoke test exercised a real feed, SQLite restart,
  a controlled feed outage and recovery. It finished paused with $50 simulated
  cash, zero orders and zero positions. See
  [the recorded evidence](../evidence/live-feed-smoke.json).
- This was not a four-hour forward test, and it does not demonstrate fills,
  profitability or uninterrupted hosting.
- Virtuals displayed **No Instance**. Its hosting review displayed **20 USDC per
  month** on 2026-10-14; no purchase was made. Recheck the checkout before payment.
  A generic runtime is not proof this worker is installed or compatible.
  Developer inference-credit approval is separate.

## Concrete first-session configuration

Runtime: Node.js 24 or newer, persistent writable disk, one worker process.
Strategy: `volume-breakout`. Initial simulated cash: $50. Session: four hours.
Inference remains disabled. This pool is selected as a data-integration test
because the user's research includes TOSHI; it is not an investment suggestion
or a promise that it will qualify for entry.

```sh
export GHOST_BASE_POOLS=0x4b0aaf3ebb163dd45f663b38b6d93f6093ebc2d3
export GHOST_ENABLE_INFERENCE=false
node scripts/feed-check.mjs
```

An exit code of zero means the scan returned market data, not that trading is
eligible. Inspect `securityPresent`, `hasLatestClosedCandle` and `decision`;
WAIT/BLOCKED must remain non-executable. A failed scan exits nonzero. This probe
never starts a session. Freshly retrieving an old quote does not prove it is a
recent trade. **This observed pool is not currently cleared for a forward run.**

After checking the runtime, disk and data, explicitly start once:

```sh
node operator.mjs start ./state/ghost-meme.sqlite volume-breakout
node operator.mjs run ./state/ghost-meme.sqlite
```

The `run` command is the supervised worker command. Restarts must run **only
`run`**, never `start`, so a restart cannot renew the four-hour session. Configure
restart on failure rather than endless restart after successful completion.
Preserve `./state/ghost-meme.sqlite` across restarts; never replace a ledger to
clear a risk lock or reset simulated losses. Keep all runtime files private.

Use a second shell on the same host and disk for status, pause or review:

```sh
node operator.mjs status ./state/ghost-meme.sqlite
node operator.mjs pause ./state/ghost-meme.sqlite
node agent/task.mjs session-review ./state/ghost-meme.sqlite
```

Pause blocks new entries. Keep the worker available for unresolved positions;
stopping the process cannot model exits. A four-hour deadline stops entries;
positions still need fresh data for modeled closure.

## Virtuals Console installation boundary

Once a hosting instance exists, verify shell access, Node 24+, persistent storage,
outbound access to both data providers and process supervision before installing
this exact public repository. Run the tests and feed check there, then start the
worker as above. Verify a fresh `lastTick` and the same session deadline after a
worker restart. Check the first session's report after four hours.

The standard macro/perpetual-futures trading templates are not this Base meme
strategy. Do not enable their live trading or scheduled trade execution for this
simulation. Any generic runtime must be configured to run this deterministic
worker; prompting a chat agent to trade does not substitute for it.

If the Console does not expose the required runtime/storage/supervision, record
that limitation before choosing another host. Do not claim that deployment,
live swaps, or credit approval happened merely because a profile exists.
