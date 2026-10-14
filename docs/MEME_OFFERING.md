# GhOsT Base meme scan offering

The EconomyOS job definition is `ghost_base_meme_scan`. It replaces the old
`ghost_base_trade_scan` description. The obsolete public `ghost_web_scraper`
offering is hidden. The meme scan is also hidden while no hosted ACP worker is
available. Its configured price remains $0.01 with a 10-minute SLA and no principal
funds required; this is staged configuration, not a live service or billing claim.

## Runnable research command

`agent/meme-scan.mjs` accepts one JSON request on standard input and returns a JSON
object containing `report`. It calls the existing unsigned Base market/security
feed and the existing meme strategy. It has no signer, order executor, inference
call, session start or ledger mutation. Node.js 24+ is required.

```sh
node agent/meme-scan.mjs < request.json
```

Request fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `poolAddress` | Yes | Full nonzero 20-byte Base pool contract, not a token address, URL or pool ID |
| `strategy` | No | `volume-breakout` (default) or `trend-pullback` |

The pool's base-token side is evaluated. The caller selects the meme token; the
software does not identify memes automatically. Additional fields, execution
requests and capital amounts are rejected. CLI input is limited to 4096 bytes.

Reports contain PASS/WAIT/BLOCKED, a reason and code, UTC epoch-millisecond
timestamps, pool/token identity, strategy, metrics and a nullable illustrative
entry/stop/2R-target plan. Both strategies use closed 5-minute candles. Risk and
freshness checks are unchanged. PASS is a research signal, never permission to
buy. Unknown or stale evidence prevents a passing signal. No sellability or
investment-return guarantee is made.

CLI exit 1 indicates invalid input, invalid clock, unavailable market data or a
pool mismatch. A completed analysis can return WAIT or BLOCKED with exit 0.
These statuses must remain distinct from successful ACP job delivery.

## Remaining service activation

The one-shot scanner is not itself a listener. The new
[`agent/acp-cli.mjs` worker](ACP_WORKER.md) connects it to official ACP CLI 1.0.40,
validates jobs, shares request budgets, journals signed-action intent, checks
deadlines, and prevents blind duplicate submissions. Local tests cover the full
simulated lifecycle through a child-process CLI fixture. Hosting, authenticated
signing and real platform delivery remain unverified. Complete the documented
integration and restart checks before making the offering public. The provider
cannot automatically refund jobs through this CLI; evaluator settlement and
manual failure resolution must be verified. Do not expose the one-shot scanner
directly as an unbounded network service.

“No stats yet” on Virtuals remains accurate until the platform records actual
completed jobs. Local tests and simulated trades are not ACP transactions and
must not be submitted as fabricated activity.
