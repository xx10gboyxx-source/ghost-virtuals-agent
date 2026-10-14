# Virtuals Compute reporting

The optional adapter uses the official Virtuals chat-completions endpoint:
`https://compute.virtuals.io/v1/chat/completions`.

Configuration is server-side only:

| Variable | Meaning |
| --- | --- |
| `GHOST_ENABLE_INFERENCE` | Must equal `true` to enable a request; absent means disabled |
| `VIRTUALS_API_KEY` | Private credential supplied to the process, never committed |
| `VIRTUALS_MODEL` | Current model ID chosen from Virtuals `/v1/models` |

Run `npm run report -- /private/path/simulation.sqlite` after local configuration.
No model choice or provider account is silently created. `.env.example` contains
empty placeholders only; this project does not automatically load `.env` files.

Each explicit report makes at most one request, with a 10-second deadline,
768-output-token request limit, no redirects, no retries, and a 32 KiB response
cap. Provider-specific token-limit support and actual billing need validation
against the selected model before use. A fresh process can make another request;
this is not an account-wide spending cap. There is no background inference loop.

The prompt receives allowlisted numeric simulation totals, bounded order
statuses, and diagnostic codes. It excludes wallet addresses, private API keys,
market titles, free-form feed errors and raw logs. Model text is labelled
commentary; it cannot control trading. Tool-call responses are rejected. Provider
errors leave deterministic reports available and do not expose raw error bodies.

Tests inject synthetic responses. No real inference request, credit expenditure,
model-quality evaluation, or deployed integration is claimed. The intended use
of credits is to evaluate explanation quality and usefulness of agent reports.

Reference checked 2026-10-14:
[Virtuals Agent Compute documentation](https://os.virtuals.io/agent-identity/compute/overview).
