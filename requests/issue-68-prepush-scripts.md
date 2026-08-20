Finish #68. Typecheck-before-test already landed in 0.41.1 (`bun run test` typechecks first on both sides; quality.py typecheck blocks in 0.43.1). The leftover is the sweep for other gates that report green while checking less than they appear to.

One remaining gap: `scripts/git-hooks/pre-push` runs `bun test ./bridge` then the ctl suite, then web vitest — it never runs `bun test ./scripts`. Root `package.json` test and the ADW quality gate both include `./scripts` (check-doc-links.test.ts, push-keys.test.ts, qr.test.ts). A scripts-only failure is green on push and red in CI/`bun run test`.

Where: scripts/git-hooks/pre-push. Change the backend suite line to `bun test ./bridge ./scripts` (same argv as quality.py test_bridge). Do not edit adws/adw_modules/.

Done means: pre-push runs `./scripts` tests as well as `./bridge`. The echo text names that. POSIX chmod-based tests and web typecheck-in-test stay. `bun test ./scripts` still passes. PATCH 0.46.1 → 0.46.2 in herdr-plugin.toml, package.json, web/package.json, CHANGELOG Fixed citing the hook.

Out of scope: quality.py, permissions.py, adws/, folding more into package.json test (typecheck is already there), other issues, docs PRs #84/#86.
