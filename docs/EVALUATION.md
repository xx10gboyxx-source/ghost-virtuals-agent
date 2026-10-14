# Reproducible evaluation

Run with Node.js 24+:

```sh
npm test
npm run check:public
node examples/demo.mjs > /tmp/ghost-demo.json
```

The initial public release includes 16 automated tests: seven simulation/operator
tests and nine reporting/inference-boundary tests. `evidence/tests.txt` records
the local run. The CI workflow reruns the same checks on pushes and pull requests.
Only a completed successful GitHub Actions run establishes CI success.

The offline demo has five states: paused, pending entry, later-book fill, pending
exit, later-book exit with re-entry blocked. Its selected prices intentionally
exercise those transitions. They are synthetic fixtures, not backtests, market
predictions, realized customer results, or statistical accuracy estimates.

Not yet verified: real-provider inference, explanation quality with real market
data, current feed availability, hosted scheduling and recovery, physical Android
operation, ACP service delivery, or real-money execution. No code in this package
places real orders. Public checks are bounded heuristics for accidental sensitive
files; they are not a comprehensive security audit.
