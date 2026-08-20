# Plan — Document the ADW quality-block split (adw 2645f766)

## Context

The ADW quality blocks in `adws/adw_modules/quality.py` are **already implemented in the
working tree** — the split between `run_tests()` (the test phase) and `run_quality()` (the
full quality phase) is real, wired code. Nothing in this task changes that file: it is in
`protected_files`. The work left is purely documentation:

1. a **spec** under `specs/` describing the split (this document, copied to
   `specs/2645f766_quality-block-split.md`, is that spec), and
2. a **write-up** under `app_docs/` recording the change for operators.

No version bump: `adws/` is factory code, not app code — the functional-path regex in
`quality.py` (`bridge/`, `web/src/`, `web/public/`, `scripts/`, the manifests) does not
match it, and `specs/` + `app_docs/` are docs. The version files stay where this branch has
them (**0.44.0** in `herdr-plugin.toml`, `package.json`, `web/package.json`, matching the
newest CHANGELOG heading). No tag, no new CHANGELOG heading, and the existing
`## [0.43.1]` entry — which describes the first wiring of the real suites — is left exactly
as written.

## The split, as implemented (spec content — must match this exactly)

### `run_tests()` — the deterministic test phase

Runs exactly four blocks, in this order, each as its own traced quality check:

| # | Block | Command | Area | Timeout |
|---|-------|---------|------|---------|
| 1 | `typecheck_bridge` | `bun run typecheck` | backend | 300s |
| 2 | `typecheck_web` | `bun run --cwd web typecheck` | frontend | 300s |
| 3 | `test_bridge` | `bun test ./bridge ./scripts` | backend | 600s |
| 4 | `test_web` | `bun run --cwd web vitest run` | frontend | 900s |

Rationale pinned in the source:

- **`test_bridge` is deliberately *not* the root `bun run test`** — that also drags in the
  `collie-ctl` lifecycle suite, which on Windows exits 0 as a skip. The ctl suite is its own
  block (`test_ctl`) in `run_quality()` only.
- **`test_web` is Vitest only.** Typechecking is the separate `typecheck_web` block, so a
  type failure and a test failure each keep their own output tail.
- **`bun --cwd` goes after the subcommand**: `bun run --cwd web vitest run`, never
  `bun --cwd web run …` — the latter silently lists scripts instead of running them.
- Both typechecks exist because Collie is two codebases: the root tsconfig
  (`noUncheckedIndexedAccess`) covers bridge + scripts, and `web/` has its own stricter
  config — Vite strips types without checking them, so a type error builds clean and ships.

### `run_quality()` — the full quality phase

Runs eight blocks, in this order: **`versions`, `version_bump`, `typecheck_bridge`,
`typecheck_web`, `test_bridge`, `test_web`, `test_ctl`, `build`** — i.e. the four
`run_tests()` blocks plus four gates around them.

- **`versions`** (Python logic, not a subprocess): the four version sources must agree —
  `herdr-plugin.toml` (canonical), `package.json`, `web/package.json`, and the newest
  `## [x.y.z]` heading in `CHANGELOG.md`. Same invariant as `scripts/check-version.sh`.
- **`version_bump`** (Python logic): if any functional path changed (regex identical to
  `scripts/git-hooks/pre-commit`), the `herdr-plugin.toml` version must differ from HEAD's;
  a version that went *backwards* fails outright. Exists because a sandbox clone has no
  `core.hooksPath` (#74).
- **`test_ctl`**: the lifecycle suite for the platform the process is actually on —
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File contrib/windows/collie-ctl.test.ps1`
  on `win32`, else `bash scripts/collie-ctl.test.sh`. 180s.
- **`build`**: `bun run build`. It lives in `run_quality()` **only, never the SDLC inner
  loop** — it rewrites gitignored `web/dist`, which on a host serving from this checkout is
  the **live deployment** (the bridge serves `web/dist` from disk at request time).

### Cross-cutting rules (all pinned in the file's banner and helpers)

- **Each failing check keeps its own 4k tail** — `TAIL_CHARS = 4_000`;
  `output_tail = (stdout + stderr)[-4000:]`, and `_collect` builds one failure string per
  failed check from *that check's* tail, so a runaway stack trace can't swamp the others.
- **argv lists, never shell strings** — no quoting bugs, no shell injection.
- **Bare binary names** — the blocks inherit the operator's environment
  (`utils.operator_env`), so `bun` resolves exactly as in their terminal; never bake an
  absolute path into a trace.
- **A failing block does not fail the phase** — the runner did its job; the code is what
  failed. `run_quality()` collects *all* failures in one pass and hands them to the builder
  via `as_envelope`, the adapter that makes a `QualityResult` look like an agent's
  `VerifyOutput`.
- **Missing installs are self-healing** — `_ensure_installs` runs
  `bun install --frozen-lockfile` (root and/or `web/`) only when the corresponding
  `node_modules` is absent; host checkouts already have them.
- `QualityOperation` has no "test" value (its `data_types.py` is not repo-owned), so the
  test blocks use `operation="build"` with a `name=` that says what they are.

## Files to touch (builder)

1. **`specs/2645f766_quality-block-split.md`** — done by the planner: this plan is the spec,
   copied there verbatim. The builder does **not** rewrite it.
2. **`app_docs/2645f766_quality-block-split.md`** (new) — the operator-facing write-up.
   Model it on the existing app_docs entries (e.g. `dfd55093_doc-links-git-bash.md`):
   a "What Changed" section (the run_tests/run_quality split with the exact block lists and
   commands from the table above), a background section (the 0.43.1 placeholder→real
   wiring history, #60, and why `build` re-entered `run_quality()` — the phase that ships
   must prove the tree builds — while staying out of the inner test loop), a "Changed
   Files" section (`adws/adw_modules/quality.py`, the spec, the write-up itself), and a
   verification section. Note in prose that the 0.43.1 CHANGELOG entry ("`build` dropped
   deliberately") describes the wiring as it stood then and is historical — do not edit it.
3. Nothing else. In particular:
   - **Do not edit `adws/adw_modules/`, `adws/adw_sssf_config/`, or `adws/adw_*.py`** —
     protected; `quality.py` is already correct as written.
   - **No version bump** in `herdr-plugin.toml` / `package.json` / `web/package.json` —
     they stay 0.44.0 (doc-only + factory code).
   - **No new CHANGELOG heading, no rewrite of the 0.43.1 entry, no git tag.**
   - **Never run `bun run build` against the live checkout as a "fix"** — it rewrites
     `web/dist`, which is the live deployment on a host serving from this tree.

## Verification

1. `git status` — only `specs/2645f766_quality-block-split.md` (planner's copy) and
   `app_docs/2645f766_quality-block-split.md` (builder's) are new; nothing under
   `adws/` modified; no version file touched.
2. Cross-check the write-up's block lists and commands against
   `adws/adw_modules/quality.py` itself — `run_tests`, `run_quality`, and each block's
   argv must match character for character (including `bun test ./bridge ./scripts`,
   `bun run --cwd web vitest run`, and the powershell/bash branch of `test_ctl`).
3. `bash scripts/check-version.sh` still prints `✓` — versions were never touched, this
   just proves it.

## Commit

One doc-only commit: `Document the ADW quality-block split (adw 2645f766)` — spec +
write-up together, no bump needed (doc-only change; the pre-commit hook agrees).
