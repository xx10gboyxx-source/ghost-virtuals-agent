# Security and privacy

GhOsT v0.5 includes a real token-trading executor in `live/`. It can sign ERC20
approvals and swaps for canonical Base Uniswap v3 pools quoted in USDC or WETH
when the user configures a wallet and runs the explicit live command. `npm start`
is the separate wallet-free research/simulation runner. The public portal provides
research, not wallet custody or hosted customer trading. See [LIVE.md](docs/LIVE.md).

The live runner reads `GHOST_LIVE_PRIVATE_KEY` from its local process environment;
it does not provide a hardware-wallet or managed-custody security boundary. Protect
that host and keep the key out of chat, the portal, source and logs. The private
SQLite journal contains signed transaction bytes that may be rebroadcast; restrict
access and preserve it for recovery. Use one dedicated wallet/journal/worker and
do not share its nonce with another program.

Exact approvals, route validation, slippage limits, durable transaction hashes and
reconciliation checks are implemented controls, not an independent security audit.
The published suite includes 82 live execution tests with deterministic RPC fixtures
and real signing/SQLite. Funded mainnet and fork-based end-to-end operation remain
unverified; the fork stops on missing L1 fee evidence. Provider failures, compromised hosts,
token behavior, gaps and MEV can cause losses; monitored exits require a running
host, usable data, RPC access and gas and cannot guarantee execution or cap loss.

The separate ACP worker delegates signed provider fee/submission actions to an
externally authenticated official CLI when run in that mode. Its host/signing
integration and authenticated delivery remain unverified. Inference is disabled
by default and has no order authority. Keep any optional compute key in the host's
secret store, and keep runtime SQLite databases and logs outside public source.

Do not upload `.env` files, API keys, wallet seed phrases, signing keys, customer
data or private logs. The ignored runtime files and automated public-content
checks reduce accidental disclosure; they are not a complete secret scanner or
security audit.

Model commentary is untrusted text. Render it as text if integrating into a UI;
never evaluate it as code or HTML or use it to change permissions or risk limits.

For a possible vulnerability, contact @PulseLayerAI to arrange a private report.
Public Issues should contain only a redacted description. Do not post exploit
credentials or private customer evidence.
