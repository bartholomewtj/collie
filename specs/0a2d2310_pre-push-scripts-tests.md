# Plan — pre-push hook must run `./scripts` tests, not just `./bridge`

Issue #68 leftover. The typecheck-before-test work already landed in 0.41.1; the remaining gap is
that `scripts/git-hooks/pre-push` reports green while checking less than the full backend suite:
it runs `bun test ./bridge` + the ctl lifecycle suite + web vitest, but never `bun test ./scripts`.
Root `package.json` `"test"` and the ADW quality gate both include `./scripts`
(`check-doc-links.test.ts`, `push-keys.test.ts`, `qr.test.ts`), so a scripts-only failure is green
on push and red in CI / `bun run test`.

## Scope

- **Touch:** `scripts/git-hooks/pre-push`, `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md`.
- **Do NOT touch:** `adws/`, `adw_modules/`, `quality.py`, `permissions.py`, docs PRs #84/#86, `package.json`'s `test` script (typecheck already there).

## Changes

### 1. `scripts/git-hooks/pre-push` — widen the backend suite line

In the "Tests" section, change the backend suite invocation to match `quality.py`'s `test_bridge`
argv exactly:

```bash
echo "pre-push: running backend test suite (bun test ./bridge ./scripts)…" >&2
if ! (cd "$ROOT" && bun test ./bridge ./scripts); then
```

Notes:
- Only the `bun test ./bridge` line and its echo text change — one `bun test` invocation with two
  path args, **not** a second suite block. The failure heredoc below it can stay as-is (it already
  says "backend tests failed").
- The echo text names `./scripts` (shown above) — that's the "echo text names that" requirement.
- Leave everything else alone: the two typecheck blocks, the `unset "${!GIT_@}"` trap, the
  per-platform ctl lifecycle branch, the web vitest block, `SKIP_TYPECHECK`/`SKIP_TESTS` overrides.
- POSIX chmod-based tests stay untouched — a couple of the `./scripts` tests
  (`check-doc-links.test.ts` symlink fixtures etc.) assert `POSIX_MODES`/`CAN_SYMLINK` and skip on
  Windows; that's existing behaviour and the hook needs no special-casing for it.

### 2. Version bump — PATCH 0.46.1 → 0.46.2

Same number in all three files (currently all at `0.46.1`):
- `herdr-plugin.toml` line 3: `version = "0.46.2"`
- `package.json` line 3: `"version": "0.46.2"`
- `web/package.json` line 3: `"version": "0.46.2"`

Axis is PATCH: the hook now does what it always claimed to — same guarantee, closed gap. Note the
dev-deployment corollary does not apply here (a git hook isn't shipped by the build), but the
bump is required anyway: the hook is functional code under `scripts/`.

### 3. `CHANGELOG.md` — new entry under a `## [0.46.2]` heading

Insert above `## [0.46.1] - 2026-08-20`:

```markdown
## [0.46.2] - 2026-08-20

### Fixed
- pre-push hook now runs the ./scripts tests alongside ./bridge, closing the gap where a scripts-only failure was green on push but red in CI
```

Style: one line, crisp, `Fixed` section (cite commit hash at line end per repo style once the
functional commit exists — this plan's builder commits the hook change first, then the release
commit gets the CHANGELOG; if committing as one change, cite that hash).

## Verification

1. `bun test ./scripts` — must pass (baseline confirmed: 28 pass, 3 files, on this machine).
2. `bash scripts/check-version.sh` — must print `✓` (all four version refs agree on 0.46.2).
3. Sanity on the hook: `bash -n scripts/git-hooks/pre-push` (syntax), and confirm the only diff is
   the one suite line + echo + the four release files.
4. Optional real check: `scripts/install-hooks.sh` then a no-op push, or run the changed line
   directly: `cd <repo> && bun test ./bridge ./scripts` — must exit 0 and run 3 script test files.

## Out of scope

`quality.py`, `permissions.py`, `adws/`/`adw_modules/`, further changes to root `package.json`
`test` (typecheck already folded in), other #68-adjacent gaps, docs PRs #84/#86.
