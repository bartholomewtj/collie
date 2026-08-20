# Pre-Push Hook: Run `./scripts` Test Suite Alongside `./bridge`

## Summary

Widens the backend test invocation in `scripts/git-hooks/pre-push` to run `bun test ./bridge ./scripts` instead of testing only `./bridge`. This closes a test gating gap where scripts tests (`check-doc-links.test.ts`, `push-keys.test.ts`, `qr.test.ts`) were executed in CI and `bun run test` (as well as ADW `quality.py`), but omitted by the local pre-push hook.

## Context & Motivation

Issue #68 established typecheck-before-test and consistent testing gates across the repository. While root `package.json` test scripts and quality checks included `./scripts` test suites, `scripts/git-hooks/pre-push` only invoked `bun test ./bridge` alongside the ctl lifecycle tests and frontend Vitest suite. A regression in script unit tests could pass the pre-push check locally while failing in CI.

## Changes

### 1. Pre-Push Hook (`scripts/git-hooks/pre-push`)
- Updated the backend test run step to execute:
  ```bash
  bun test ./bridge ./scripts
  ```
- Updated the echo message to explicitly mention the expanded suite:
  ```bash
  echo "pre-push: running backend test suite (bun test ./bridge ./scripts)…" >&2
  ```

### 2. Version Bump (0.46.1 → 0.46.2)
Per repo policy, functional changes under `scripts/` require a version bump across canonical files:
- `herdr-plugin.toml`: bumped version to `0.46.2`
- `package.json`: bumped version to `0.46.2`
- `web/package.json`: bumped version to `0.46.2`
- `CHANGELOG.md`: added entry under `## [0.46.2] - 2026-08-20` recording the fix

### 3. Specification
- `specs/0a2d2310_pre-push-scripts-tests.md`: plan and scope documentation for this change.

## Verification

1. **Version check**:
   ```bash
   bash scripts/check-version.sh
   ```
   Passes and prints `✓` matching `0.46.2` across `herdr-plugin.toml`, `package.json`, `web/package.json`, and `CHANGELOG.md`.

2. **Scripts test suite**:
   ```bash
   bun test ./scripts
   ```
   Runs and passes all unit tests under `./scripts`.

3. **Combined backend test suite**:
   ```bash
   bun test ./bridge ./scripts
   ```
   Executes both bridge and script test suites cleanly.
