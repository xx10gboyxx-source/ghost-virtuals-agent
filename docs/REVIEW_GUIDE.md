> v0.5 adds the separate [live executor](LIVE.md) and [public portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/). Research/ACP evidence below does not establish funded trading results.

# GhOsT v0.4 reviewer guide

GhOsT is a Base meme-coin research and paper-trading agent prototype. Its active
workflow evaluates spot tokens. It no longer runs the BTC outcome-contract strategy.

## Reproduce

Node.js 24+, no key, wallet, external dependencies or funds:

```sh
npm test
npm run demo
npm run runtime:demo
npm run agent:demo
npm run evaluate
npm run check:public
```

161 automated tests pass, covering feed, strategy, simulation recovery, ACP jobs,
readiness, reporting and research tasks. The evaluation has 20 declared synthetic cases. Tests use
synthetic responses; no live-provider quality or investment performance is measured.

| Capability | Implementation | Evidence |
| --- | --- | --- |
| Continuous no-money research | `agent/runtime.mjs` + `agent/run.mjs` | Runtime lifecycle, recovery, report and rate-budget tests |
| Automatic token-pool discovery | `server/pool-discovery.mjs` | Identity, liquidity selection, timeout and cache tests |
| Base spot identity and pool data | `server/base-meme-feed.mjs` | Feed identity, parsing, timeout and rate-limit tests |
| Token-risk evidence | Same feed + `server/meme-strategy.mjs` | Missing/flagged risk, tax, holders and source tests |
| Volume breakout and trend pullback | `evaluateMeme` | Both eligible fixtures, chase/volume/history rejection |
| Later-quote paper execution | `operator.mjs` | Same/pre-order quote rejection, persistence, costs and exits |
| Risk/session controls | `operator.mjs` | Gap-loss lock, pause, expiry and concurrency tests |
| BTC ledger isolation | `MemeOperator` constructor | Legacy-ledger rejection test |
| Evidence-linked research | `agent/task.mjs` | Citation, freshness, missing-data and immutability tests |
| Optional Virtuals inference | `agent/reporter.mjs` | Bounded synthetic HTTP contract and failure tests |

The input schema uses millisecond timestamps except `candles[].time`, which is
Unix seconds. Pool/token addresses must identify Base chain 8453. Only closed,
contiguous 5-minute bars enter signals. `screenMeme` checks supplied evidence;
it cannot authenticate a caller-created object. The feed provides actual provider
origin constraints. A passing screen never guarantees future sellability.

Only two research tasks are allowed: `explain-wait` and `session-review`. Their
fixed observe/inspect/assess/explain workflow receives a sanitized snapshot.
PASS means recorded checks passed, not authority to place a transaction. Models
cannot choose tools, access signers, change risk settings or control the operator.

## Intended credit use

Use Virtuals Compute to evaluate explanations of meme-token screening results,
uncertainty, rejected setups and paper-session risk. Measure evidence fidelity,
latency and credit use against recorded cases. No real inference, hosted ACP
service, customer adoption or profitability is claimed.

Source is public under NOTICE, not open-source licensed. Public code supplies
reviewable evidence; it cannot guarantee automatic detection or credit approval.
We request discretionary/manual review of this implementation.

## External contracts

- [GeckoTerminal API](https://api.geckoterminal.com/docs/index.html)
- [GoPlus token security](https://docs.gopluslabs.io/reference/tokensecurityusingget_1)
- [GoPlus response meanings](https://docs.gopluslabs.io/reference/response-details)
- [Virtuals Compute](https://os.virtuals.io/agent-identity/compute/overview)

Contracts inspected 2026-10-14. A bounded live-feed probe is recorded in
[HOSTING.md](HOSTING.md); hosted delivery and trading remain unverified. The
[readiness audit](READINESS.md) records fixes and blocking gaps. No provider field,
test score or screen is an investment endorsement.
