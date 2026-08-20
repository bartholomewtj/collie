# ADW Quality-Block Split

## What Changed

The ADW quality module (`adws/adw_modules/quality.py`) defines a structured split between deterministic test execution (`run_tests()`) and full quality gate enforcement (`run_quality()`), establishing distinct block boundaries, bounded output tails, and isolated execution scopes.

### 1. `run_tests()` — Deterministic Test Phase

`run_tests()` executes four hermetic, side-effect-free quality checks:

| # | Block | Command | Area | Timeout |
|---|-------|---------|------|---------|
| 1 | `typecheck_bridge` | `bun run typecheck` | backend | 300s |
| 2 | `typecheck_web` | `bun run --cwd web typecheck` | frontend | 300s |
| 3 | `test_bridge` | `bun test ./bridge ./scripts` | backend | 600s |
| 4 | `test_web` | `bun run --cwd web vitest run` | frontend | 900s |

Key invariants:
- **`test_bridge` is `bun test ./bridge ./scripts` (NOT root `bun run test`)**: The root test script invokes the `collie-ctl` lifecycle suite, which on Windows exits 0 as a skip and requires platform-specific harness isolation. The lifecycle suite belongs in `run_quality()` under `test_ctl`.
- **`test_web` is Vitest only**: Typechecking is isolated in `typecheck_web` so that type errors and test assertions retain independent failure logs and output tails.
- **`bun --cwd` follows the subcommand**: Invocations use `bun run --cwd web <cmd>`, never `bun --cwd web run <cmd>` (which lists package scripts rather than executing them).

### 2. `run_quality()` — Full Quality Phase

`run_quality()` executes eight blocks in a strict sequence:
1. `versions`
2. `version_bump`
3. `typecheck_bridge`
4. `typecheck_web`
5. `test_bridge`
6. `test_web`
7. `test_ctl`
8. `build`

Specific gate definitions:
- **`versions`** (Python logic): Verifies that `herdr-plugin.toml` (canonical), `package.json`, `web/package.json`, and the newest `## [x.y.z]` heading in `CHANGELOG.md` all agree.
- **`version_bump`** (Python logic): Enforces that if any functional paths (`bridge/`, `web/src/`, `web/public/`, `scripts/`, manifests) were modified, `herdr-plugin.toml`'s version differs from HEAD's and has not regressed.
- **`test_ctl`**: Invokes the platform-specific lifecycle suite:
  - Windows (`win32`): `powershell.exe -NoProfile -ExecutionPolicy Bypass -File contrib/windows/collie-ctl.test.ps1`
  - POSIX: `bash scripts/collie-ctl.test.sh` (timeout 180s).
- **`build`**: Runs `bun run build` (timeout 300s). **Lives exclusively in `run_quality()`**, never in `run_tests()`. `build` writes directly to `web/dist`, which the bridge serves live from disk on the host checkout; it must not run during inner-loop testing.

### 3. Cross-Cutting Execution Rules

- **Bounded 4k Tail**: `TAIL_CHARS = 4_000`. Each failing block captures `(stdout + stderr)[-4000:]` independently, preventing a verbose stack trace from swamping the builder agent's handoff envelope.
- **Argv Lists & Bare Binaries**: All commands execute as `list[str]` with bare binary names (`bun`, `powershell.exe`, `bash`) resolved via `utils.operator_env`, avoiding shell interpolation bugs and machine-specific hardcoded paths.
- **Non-Fatal Runner Collection**: `run_quality()` executes all blocks to completion, gathers all failures via `_collect()`, and wraps the result in `as_envelope()` (`VerifyOutput`) for builder remediation.
- **Self-Healing Installs**: `_ensure_installs()` checks for `node_modules` and `web/node_modules`, running `bun install --frozen-lockfile` only when missing.

## Background

Earlier ADW quality phases ran placeholder checks (`echo` exiting 0) which allowed regressions to slip into main (#60). The 0.43.1 release established the first wiring of real test suites. The `CHANGELOG.md` entry under `0.43.1` is historical and records the initial state where `build` was removed from the general test flow.

In this architecture:
- `run_tests()` acts as the lightweight, side-effect-free inner loop for the SDLC test phase.
- `run_quality()` acts as the comprehensive pre-release gate, ensuring version consistency, lifecycle validity, and production build readiness before shipping.

## Changed Files

- `adws/adw_modules/quality.py`: Implementation of `run_tests()`, `run_quality()`, block specifications, version checks, and test runner adapters.
- `specs/2645f766_quality-block-split.md`: Specification document detailing the quality block split contract.
- `app_docs/2645f766_quality-block-split.md`: Write-up describing the quality block split and invariants.

## Verification

1. Verify version files and check script consistency:
   ```bash
   bash scripts/check-version.sh
   ```
   Must output `✓`.

2. Inspect git status to confirm no unauthorized modifications to protected files or version files:
   ```bash
   git status
   ```
