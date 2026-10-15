# Contributing

Open an issue with a reproducible case, expected behavior, actual behavior and
Node version. Use synthetic data. Do not include credentials or private logs.

Changes should preserve simulation/live isolation, explicit session starts,
freshness checks, bounded requests and the separation between commentary and
engine decisions. Run `npm test`, `npm run demo`, and `npm run check:public`.
Also run `npm run check:docs` after changing public documentation or project metadata.
Keep hosted research, the user-run live executor and staged ACP delivery distinct.
Update evidence counts from reproducible runs, never from uncommitted test claims.
Document any unverified integration rather than claiming it is operational.

This repository is public for inspection, with no open-source license currently
granted. Discuss redistribution or other licensing needs with the owner first.
