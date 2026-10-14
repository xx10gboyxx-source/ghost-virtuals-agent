# Run GhOsT with real Base assets

Version 0.5 includes a user-run live executor. `npm run live -- run` can approve and
swap real ERC20 tokens in a configured wallet. It uses the same closed five-minute
volume-breakout or trend-pullback rules as the research scanner. `npm start` remains
the separate no-money research/simulation command.

The public [GhOsT portal](https://ghost-base-meme-agent-dz39ls.v2.appdeploy.ai/) runs
research scans. The live runner runs on your own Node.js 24 computer/server. There
is no hosted customer trading account, wallet custody or automatic Virtuals wallet
connection. No operator approval service or inference credit is needed by the runner.

## Install and configure

```sh
git clone https://github.com/xx10gboyxx-source/ghost-virtuals-agent.git
cd ghost-virtuals-agent
npm ci --ignore-scripts
cp examples/live-config.example.json live-config.json
```

Edit the three `REPLACE_...` values in `live-config.json`:

- `walletAddress`: the dedicated Base wallet you control.
- `tokenAddress`: the exact meme-token contract, on the feed's base-token side.
- `poolAddress`: that token's canonical **Uniswap v3 Base** pool against native
  USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) or WETH
  (`0x4200000000000000000000000000000000000006`). A token address is not a pool address.

The runner verifies the pool's factory, token pair, fee and canonical factory
mapping on chain. Aerodrome, v2, v4, Solana, taxed/rebasing tokens, other quote assets
and arbitrary routers are not supported. Research discovery can return a pool that
this execution adapter does not support; `check` identifies that before a session.

Set `GHOST_BASE_RPC_URL` to your HTTPS Base RPC endpoint. If omitted, the public
`https://mainnet.base.org` endpoint is used; its capacity may be insufficient for
continuous operation. RPC responses must include Base L1 fee fields and historical
balance/allowance reads at the receipt block. Do not put credentials in the JSON.

```sh
export GHOST_BASE_RPC_URL='https://mainnet.base.org'
npm run live -- check ./live-config.json
```

`check` is read-only: it verifies fresh public data, on-chain pool identity, balances
and the strategy decision. It needs only the wallet's public address. `funded: true`
means the wallet currently has the configured quote capital and six transaction gas
reserves; it does not mean a strategy entry exists. WAIT/BLOCKED are ordinary results.

The wallet needs the pool's quote ERC20 (USDC or **WETH**) and separate native ETH
for gas. The code never treats plain ETH as WETH or wraps assets automatically.
Default allocation is $50 in quote assets, with a $5 maximum position. Existing
unallocated quote tokens and existing meme tokens are recorded separately and are
never treated as agent profits or inventory.

## Start actual execution

Configure the signing key **locally on your own host** as `GHOST_LIVE_PRIVATE_KEY`.
Never enter it into the portal, chat, source files or a public repository. For a local
Bash session, this reads the key without putting it into shell command history:

```sh
read -r -s -p 'Local trading key: ' GHOST_LIVE_PRIVATE_KEY
export GHOST_LIVE_PRIVATE_KEY
printf '\n'
npm run live -- run ./live-config.json
```

The signer address must match `walletAddress`. A first run allocates actual wallet
quote assets and starts the configured entry session. It checks every 15 seconds
after a cycle; the market adapter caches quotes for up to 60 seconds. Keep the host
running to monitor exits. SIGINT/SIGTERM stop the process; restart with the same
config and database to recover the recorded session. A restart never renews it.

The default private journal path includes wallet and pool under `state/`. Append an
absolute private SQLite path to **every** command to use a different persistent disk.
Keep one journal/worker per dedicated wallet; never share its nonce with another bot.
Do not delete the journal to recover from an unresolved transaction or loss lock.

| Command after `npm run live --` | Behavior |
| --- | --- |
| `check ./live-config.json` | Read-only market, route and balance checks |
| `run ./live-config.json` | Continuous signing, submission, reconciliation and position monitoring |
| `once ./live-config.json` | One live cycle; can submit a real transaction |
| `status ./live-config.json` | Saved state, positions, costs and transaction hashes; no raw signed bytes |
| `pause ./live-config.json` | Stop new buys; the running worker retains exits and receipt checks |
| `start ./live-config.json` | Explicitly resume/start a session; preserve active deadline and loss locks |
| `retry-exit ./live-config.json` | Allow another bounded exit attempt after two confirmed exit reverts |

`pause` cannot cancel a transaction already submitted to the network. At session
expiry new buys stop and existing positions request an exit. BUY swap deadlines are
bounded by that session. The default session is four hours; set `sessionHours` to an
integer from 1 to 24. Expired sessions are renewed only by an explicit `start` after
the existing position/transaction is resolved.

## Execution and accounting

Every entry must pass market/security screening and have explicit fresh zero-tax
evidence. The broker checks the QuoterV2 output against independent token/quote USD
prices (default maximum 3% mismatch), imposes a minimum output (default 1% slippage),
simulates the exact call and checks balances, nonce, gas and fee ceilings.

Approvals are exact amounts, never unlimited. A different existing allowance is
reset to zero first. Swaps use deadline-wrapped SwapRouter02 single-pool calls, no
native value, arbitrary calldata, bridging, Permit2 or approval of unknown routers.
Signed bytes are saved privately before submission. Timeout recovery tracks and
rebroadcasts the same hash, with at most three broadcasts, rather than allocating a
new nonce. Confirmed receipts require two block confirmations, canonical block and
transaction identity, expected pool events, transfer amounts, allowances and wallet
balances. Only confirmed amounts create/change positions. Gas includes L2, L1 and
operator fees. Missing or conflicting evidence leaves the transaction unresolved.

The position stop uses the strategy's ATR/percentage distance, rebased to the actual
fill; the target is 2R before costs. Stops are monitored market exits, not guaranteed
on-chain stop orders. Risk sizing includes fee/slippage and gas reserves for entry
and exit. The net target must exceed estimated round-trip costs. Session buy spend,
UTC-day observed equity loss and drawdown limits are persisted. Gas reserves are
estimates: Base L1/operator fees cannot be hard-capped by the signed transaction.

Default `maxGasWei` is `5000000000000` (0.000005 ETH per transaction estimate ceiling),
`maxFeePerGasWei` is `10000000000` (10 gwei), risk is 0.5% of marked equity, session
buy spend is $50, daily loss is $1.50 and drawdown is $5. These values are configurable
within validated bounds. High costs or missing data can produce no trade.

## Recovery diagnostics

- `TRANSACTION_PENDING`: retain the journal and check the recorded hash. An expired
  submitted transaction remains unresolved until RPC evidence explains its outcome.
- `TRANSACTION_RECONCILIATION_REQUIRED`: receipt/fee/log/balance identity could not
  be established. No new nonce is created. Restore reliable RPC access and retain
  the journal. A saved reconciliation lock remains for operator review.
- `WALLET_RECONCILIATION_REQUIRED`: external ERC20 transfers or another process changed
  allocated balances. Reconcile the wallet/journal before resuming.
- `INSUFFICIENT_ETH_GAS`: retain the intent/position; supply gas locally if desired.
- `EXIT_FAILURE_LIMIT`: two confirmed exit transactions reverted. Automatic attempts
  stop, the real position remains visible, and `retry-exit` is an explicit recovery
  command after the cause is addressed. Existing loss locks remain in force.

The current tests use real viem transaction encoding/signatures with deterministic
RPC fixtures plus real SQLite restart tests. **No funded mainnet trade or fork-based
end-to-end trade has been verified for this release.** No performance or return is
established. The source provides execution capability; deployment and actual wallet
configuration remain with each user.

Official contract reference: [Uniswap Base v3 deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments).
