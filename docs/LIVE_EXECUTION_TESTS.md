# Live Base execution verification

This change adds automated evidence for the live broker and durable agent. It is
not funded mainnet validation, an independent security audit, or a profitability
result. Machine-readable results and source hashes are in
[live-execution-verification.json](../evidence/live-execution-verification.json).

The inspected main commit was `75a0ddf98c9abfef639689d511570319ec060b9e`.
Its published suite passed with a total of 136 cases and no live-module imports;
the earlier claim of 161 was not reproducible. The new suite adds 82 live cases.
The complete run passed with a total of 218, zero failures and zero skips, on Node
24.19.0. These counts describe this verification snapshot.

## Fixes demonstrated against the original broker

The new broker test file run against that original commit fails seven cases:

- A malformed pending nonce could reach raw transaction submission. Both observed
  nonce counts now must be nonnegative safe integers before a broadcast.
- An absent receipt was always called pending, even when the confirmed wallet nonce
  had advanced past the reserved nonce. This now yields unresolved `NONCE_CONSUMED`,
  which the agent persists as a reconciliation lock. No replacement is assumed to
  be a successful fill and the reservation remains occupied.
- A reverted receipt returned early, before wallet/allowance/nonce reconciliation
  and the final canonical-block check. Reverts now require unchanged ERC20 balances
  and allowance, exactly one consumed nonce, the expected native gas debit, no logs,
  and a stable block identity. Conflicting evidence remains unresolved.

The five revert regressions cover unexpected quote and native transfers, another
nonce, changed allowance, and a reorganization during reconciliation. All seven
regressions now pass. The strategy, capital/risk limits, session semantics and
wallet isolation code are unchanged.

## Reproduce the required offline checks

```sh
npm ci --ignore-scripts
npm run test:live
npm test
npm run evaluate
npm run check:public
git diff --check
```

`test:live` runs the dedicated broker and agent files. `npm test` includes them in
the complete suite. The ordinary push/PR workflow installs the pinned dependencies,
runs all cases, and uploads TAP evidence even when a test fails. No credentials,
external RPC requests, live-runner activation or on-chain transactions occur in
these offline checks. Fixture signing accounts are derived from public test labels;
they must never receive real assets.

| Acceptance area | Evidence | Demonstrated scope |
| --- | --- | --- |
| Chain, pool and tokens | `tests/live-broker.test.mjs` | Base chain, canonical factory mapping, token membership, USDC/WETH only, decimals and balances; rejects unsupported routes |
| Approvals and signing | Broker cases | Real viem encoding/signatures and sender recovery; allowance reset, exact approval, zero native value; tampered signer/record rejected |
| Price, gas and deadline | Broker cases | Reference identity/freshness, price mismatch, minimum output, exact swap calldata, deadline wrapper, L2/L1/operator budget and broadcast rechecks |
| Durable intent before send | `tests/live-agent.test.mjs` | Real SQLite FULL/WAL journal read through an independent connection at send time; both PREPARED and SUBMITTING write failures prevent send |
| Interruption, conflict, duplication | Both live files | Failure before send, lost response after acceptance, bounded retries of identical bytes, nonce conflicts and consumed-nonce replacement lock |
| Receipt and wallet evidence | Broker cases | Two confirmations, block/transaction identity, exact transfers and pool event, partial/taxed transfers rejected, full gas and wallet reconciliation |
| Restart and bookkeeping | Agent cases | Reopen real journal after submission and before/after fill commit; one booking, preserved reservations, cash, session deadline and inventory |
| Failed exits | Agent cases | Two verified reverts stop automatic retries; position retained; explicit retry stays entry-disabled; uncertain revert stays reserved |
| Controls and isolation | Agent cases | Same-journal worker contention, lease expiry, corrupt binding, wallet/config mismatch, simulation database exclusion, pause/session expiry, bounded configuration |

The RPC fixture replaces only the network boundary. The broker, signer, ABI encoder,
signature recovery, agent and SQLite implementation are real. Synthetic receipts and
contract results cannot establish actual EVM, sequencer or public-provider behavior.
Storage fault injection/reopening is not a physical power-loss or disk-corruption test.

## Zero-funds Base fork investigation

The separate `Zero-funds Base fork integration` workflow is **manual**, because it
depends on archive RPC availability and Anvil compatibility. It deliberately fails,
rather than skips or substitutes fee values, when reconciliation is incomplete.
It requires no secrets. Reproduce on Linux x64 with:

```sh
npm install --prefix /tmp/ghost-foundry --ignore-scripts --no-audit --no-fund @foundry-rs/anvil-linux-amd64@1.7.1
ANVIL_BIN=/tmp/ghost-foundry/node_modules/.bin/anvil npm run test:base-fork
```

The harness pins Base block **35000000**, hash
`0x9048f68cfd29ae6ce36647ace74ebdf5bffcef8528dd8183df6e3a01a92f2d18`.
It starts its own loopback-only Anvil with Optimism support, no generated accounts,
and a read-only upstream RPC proxy that cannot forward transaction submissions.
Only a public fixture account in the disposable fork receives artificial ETH.
The harness wraps local ETH into WETH and intends to execute a tiny BRETT/WETH buy
and sell through the canonical Uniswap v3 pool. Signed broker records are fsynced
before local submission. Mainnet access is read-only; no real funds or user wallets
are used.

**Observed result: failed/unverified.** Anvil 1.7.1 successfully executed the local
WETH deposit and broker-signed exact approval, but the raw approval receipt omitted
`l1Fee`. The broker returned `UNKNOWN / L1_FEE_UNKNOWN`; the harness exited 1 before
swapping. See [the captured fork output](../evidence/base-fork-investigation.txt).
The exact block and approval hash reproduced on the second run. No artificial fee
field was injected, and no unresolved transaction was booked as confirmed.

## Remaining execution gaps

- Full Base-fork buy/sell and receipt-to-journal execution remain unverified until
  a compatible OP execution environment returns authentic L1/operator fee and balance
  evidence. The current harness is an explicit failing gate, not a passed fork test.
- Funded mainnet, public mempool timing, sequencer/provider outages, live replacement
  propagation, congestion and network-level duplicate handling were not exercised.
- Real fee-on-transfer/rebasing token contracts were not deployed; deterministic
  cases verify rejection of inconsistent transfers. These assets remain unsupported.
- Reorganization detection is tested during reconciliation. Recovery after a later
  reorg of an already-booked two-confirmation receipt is not implemented or verified;
  two confirmations are not a finality guarantee.
- Separate journals/processes sharing one EOA are unsupported. The lease test covers
  one journal; it does not establish wallet-global locking across different files.
- Missing market data currently defers receipt processing. Tests establish retention,
  not timely reconciliation during prolonged market-feed outages.
- Broadcast/replacement ambiguity remains deliberately locked for operator review.
  Automatic fee replacement, cancellation or releasing a nonce based on absence
  alone is not implemented. No such recovery was added by this change.

The open documentation PR #1 remains separate work. When combining changes, retain
its capability corrections and use this newer evidence for live-test status/counts.

References: [Uniswap Base deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments),
[Foundry fork testing](https://www.getfoundry.sh/guides/fork-testing).
