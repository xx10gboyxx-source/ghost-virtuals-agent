# Run GhOsT without money

This is the v0.5 local research/simulation guide. The [public portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/)
offers hosted research. Real-asset execution uses the separate [live guide](LIVE.md)
and a separately configured wallet and running host; it is never enabled by
funding a wallet or by using the commands below.

Use Node.js 24 or newer and install the pinned dependencies with `npm ci --ignore-scripts`. No wallet, signer, API key, inference credits or deposit
is used by this runner. Public market data requires internet access.

```sh
git clone https://github.com/xx10gboyxx-source/ghost-virtuals-agent.git
cd ghost-virtuals-agent
npm ci --ignore-scripts
npm start
```

The first new database receives $50 **simulated** cash and starts one four-hour
simulation entry session. The process researches every 75 seconds after each
completed cycle, saving both volume-breakout and trend-pullback reports. The
selected execution strategy defaults to volume-breakout. Research continues when
entries are paused, the entry session expires or a loss lock is reached.

## Data selection

The default watchlist contains TOSHI's published Base contract:
`0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4` ([official project](https://www.toshithecat.com/)).
Discovery chooses the highest reported liquidity among supported pools on the
first provider page, then checks market and security evidence independently.
It does not certify a token or guarantee eligible signals. Only conventional
20-byte pools with the selected token on the base side are supported.

To use a different research watchlist, export `GHOST_BASE_TOKENS` containing one
or two full Base token addresses, separated by commas. Alternatively export
`GHOST_BASE_POOLS` with one or two exact pool addresses. Set only one variable.
Discovery refreshes every 15 minutes; open positions and pending orders keep
their original pools under observation. Both strategies use closed five-minute
candles. Missing or unsafe evidence yields WAIT/BLOCKED, never invented prices.

Configuration is stored in the database. After the first run, omit environment
overrides to reuse it. Conflicting overrides fail explicitly. Stop the process
before switching configuration. Use a distinct database for a separate experiment;
do not erase a losing session to present a fresh result as recovery.

## Commands

Run controls from another terminal in the same checkout and on the same disk:

| Command | Result |
| --- | --- |
| `npm start` | Continuous research plus eligible simulated entries/exits |
| `npm run agent:once` | One bounded cycle, then exit |
| `npm run agent:status` | Saved configuration, simulation and latest cycle |
| `npm run agent:reports` | Ten most recent cycles, newest first |
| `npm run agent:pause` | Stop new entries and cancel pending buys; retain research and exit monitoring |
| `npm run agent:resume` | Explicitly resume/start a permitted entry session; retain cash, losses and risk locks |
| `npm run runtime:demo` | Offline synthetic buy, sell and restart demonstration |

Commands use `./state/ghost-agent.sqlite`. Set `GHOST_STATE_PATH` for a different
persistent private path, or append the database path after `--`, for example
`npm run agent:status -- /absolute/private/ghost.sqlite`. Keep the same path for
all controls and restarts. This project does not automatically read `.env` files.

Pausing/resuming during an active scan can return “Another runtime owns this
database”; retry after the current scan completes. Never run two workers against
the same database. SIGINT (Ctrl+C) and SIGTERM abort current public requests and
stop cleanly. Restart with `npm start`: balances, orders, history, deadlines and
paused states survive. An older direct-operator database is never silently started.
If its open positions do not match the watchlist, adoption fails explicitly.

## Understand the output

`health: RUNNING` means the cycle completed, not that a signal passed. Inspect
`marketData`, `selection.code` and each strategy's `status`, `code` and `reason`.
`marketData: WAIT` means that cycle lacked usable market snapshots. Discovery or
provider failures are retried on a later cadence without fabricated data. A
security-based BLOCKED result is a completed research result. Zero orders is
expected when the rules do not qualify an entry.

The runtime stores up to 1,000 recent cycles and the simulation ledger in SQLite.
It applies one persistent eight-request/minute budget across discovery and feed,
bounded public requests and provider 429 cooldowns, including across restarts.
A database lease prevents overlapping runtime cycles. Clock regressions stop
work instead of writing older observations. Corrupt recovery data fails closed.

Simulation is limited to one position, 0.5% modeled equity risk per entry, $5 buy
notional plus modeled gas, $50 session turnover, a $1.50 observed UTC-day loss
limit and $5 drawdown limit. Pausing and expiry preserve monitoring of existing
positions. Loss locks cannot be cleared by resume. Keep the process running for
fresh observations; a stopped computer cannot monitor exits.

## Verify and keep it running

```sh
npm test
npm run runtime:demo
npm run evaluate
npm run check:public
npm run check:docs
```

The offline demonstration verifies software behavior using synthetic observations;
its profit is not a forecast. `npm start` uses actual public provider responses.
A bounded unsigned live check discovered the default pool and retrieved market
and security data; both strategy reports blocked entry on holder concentration.
An earlier unavailable scan saved WAIT and a later scan recovered. See
[recorded runtime evidence](../evidence/runtime-smoke.json).
Public data can be unavailable, incomplete or stale, and no signal frequency or
simulated return is promised.

For continuous operation, keep this command running on an existing computer or a
Node 24 host with persistent writable disk and outbound HTTPS. A process manager
may restart the same command/path on failure; never delete the database or run
`resume` automatically as part of recovery. No hosting subscription is required
by the code, and this repository does not provision one.

The ACP customer-job worker and optional inference explanations are separate.
`npm run readiness` checks the separate ACP deployment; its BLOCKED
result does not prevent this no-money runtime from working. No live transactions
are made by any command in this guide.
