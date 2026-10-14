# Security and privacy

This prototype has no live-order client or wallet-signing capability. Inference
is disabled by default. Keep any future compute key in the host's secret store,
and keep runtime SQLite databases and logs outside this repository.

Do not upload `.env` files, API keys, wallet seed phrases, signing keys, customer
data or private logs. The ignored runtime files and automated public-content
checks reduce accidental disclosure; they are not a complete secret scanner or
security audit.

Model commentary is untrusted text. Render it as text if integrating into a UI;
never evaluate it as code or HTML or use it to change permissions or risk limits.

For a possible vulnerability, contact @PulseLayerAI to arrange a private report.
Public Issues should contain only a redacted description. Do not post exploit
credentials or private customer evidence.
