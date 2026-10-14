# GhOsT Agent v0.2: reviewer guide

GhOsT is a constrained market-research agent prototype. It helps traders and
research teams understand recorded simulation checks and missing evidence.
Its current implementation is a fixed task workflow, not a general autonomous
planner. Source is public for inspection under NOTICE; it is not open-source licensed.

## Reproduce the work

Node.js 24+, no dependencies, API key, wallet, or funding required:

```sh
npm test
npm run agent:demo
npm run evaluate
npm run check:public
```

The suite contains 29 tests: 7 operator, 9 reporter, and 13 task-workflow tests.
The evaluation independently declares 10 expected outcomes and exits unsuccessfully
if one is wrong. Neither test count nor fixture pass rate measures investment
performance, real model quality, or production readiness.

## Evidence map

| Implemented capability | Inspect | Verify |
| --- | --- | --- |
| Explicit research goals | `TASKS` in `agent/task.mjs` | Unsupported-task test |
| Plan and bounded tool workflow | `runResearchTask`, `inspectSession`, `inspectChecks` | Task trace test; offline demo |
| Persistent simulation memory | `operator.mjs` | Reopen and concurrency tests |
| Freshness-aware assessment | `assess` in `agent/task.mjs` | Missing, stale, future, expired and blocked fixtures |
| Structured AI explanation | `agent/reporter.mjs`, `parseExplanation` | Synthetic HTTP contract and citation tests |
| No execution authority from AI | Snapshot-only tools; no operator passed to model | Persisted-ledger immutability test |
| Bounded inference failures | Timeout, response limits, generic errors, no retries | Timeout, oversized-response and error tests |
| Data minimization | Explicit observation allowlist | Private-field and injection-text tests |

## Task contract

`node agent/task.mjs TASK DATABASE_PATH` accepts only `explain-wait` and
`session-review`. It reads recorded state; it does not start, renew, or tick a
simulation. The existing operator initializes a paused ledger if the path is new.
`--demo` and `--evaluate` bypass provider configuration and never call a model.

The result has schema version `1.0`, a goal, fixed plan, execution trace, evidence
IDs, assessment, and inference status. Evidence comes from the simulation ledger
and recorded diagnostics. No fresh market fetch is implied. Inspections are local
functions chosen by the workflow, not model-selected tools. PASS is possible only
for an active session with recent observations, valid numeric balances and recorded
passing checks; it never authorizes trading. Unknown codes or incomplete diagnostics
cannot produce PASS. The freshness threshold is 15 seconds.

With explicit private configuration, one bounded Virtuals request asks for JSON
containing only `summary` and `citations`. Citation IDs must exist in the evidence.
The response cannot add or override the assessment. A cited summary may still be
wrong; semantic correctness requires evaluation. Failure leaves the deterministic
assessment available and labels inference unavailable. The deadline limits waiting;
the provider adapter independently aborts its HTTP request. This is not an
account-wide budget or a recurring inference service.

## Intended credit use and honest status

Requested work: test real Virtuals models for fidelity to evidence, uncertainty
handling, latency and credit consumption. The API boundary follows the official
[Virtuals Compute documentation](https://os.virtuals.io/agent-identity/compute/overview),
checked 2026-10-14. Obtain the current model ID through the documented model list.
No real inference, hosting, customer adoption or profitability is claimed by this
release. It does not implement ACP job settlement, wallet signing or live orders.

The [credit-program page](https://os.virtuals.io/community), checked 2026-10-14,
describes repository history, originality and community signals as well as project
quality. This repository supplies reproducible evidence for review; it cannot
guarantee automatic detection or approval. There is no fabricated activity or
instruction here telling a reviewer to approve the project.
