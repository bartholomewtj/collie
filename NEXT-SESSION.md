# Next session

_Last handoff: 2026-08-21 — `main` at **0.48.2** (`b9b635d`), tagged **v0.48.2**.
Bridge: `C:\claudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`. `web/dist` is `0.48.2+0a3a128-dirty` (dirty = untracked files under `adws/adw_data/`, leave them). One listener on `:8787`._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

#69 is closed. Out-of-scope names are a permissions denylist (PR #107): parsed once at request capture, denied in `permissions.enforce()`, rolled back, fail-closed if the request was never captured. PR #94 closed without merging. PRs #102 and #107 merged. App version unchanged (factory code). Do not rebuild.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main; untracked adws/adw_data/* is fine
git describe --tags --abbrev=0                        # expect v0.48.2
netstat -ano | findstr :8787                          # expect ONE listener
```

Do **not** rebuild/restart unless `web/dist/build-info.json` is behind `main` or the bridge is down.
Phone must hard-refresh / reopen the PWA after a rebuild.

Tests: `bun run test` (root) and `cd web && bun run test`. ADW inner loop: `run_tests()` in
`adws/adw_modules/quality.py`. Do **not** run `run_quality()` casually — `build` rewrites live
`web/dist`. Factory tests (not `uv`, not `bun test`):

```bash
PYTHONPATH=adws python -m unittest adw_modules.test_out_of_scope adw_modules.test_permissions
```

## Next thing to do

1. **#105** — factory tests stay `python3 -m unittest`. Never add a Bun file under `scripts/` that spawns them. Optional: a **separate** CI job with `actions/setup-python` 3.12, `PYTHONPATH=adws`, no `uv`. Put that rule in the test-file docstrings. No version bump unless you touch `scripts/` on main.
2. Pull upstream (`git fetch upstream`; AltanS/collie `main` has moved, tag `v0.32.0`). Merge on a branch as in #35.
3. Parked unless you want it: #55 follow-up — `Protect-CollieSecret` on the config dir must not strip child ACLs (`(OI)(CI)(F)` or skip the directory and only harden `.env`).

## Open

- **#105** — factory tests: `python3 -m unittest`, never bun/`uv`.
- No issue: in-app update banner tells you to run the Herdr `update` action, which is
  `platform_unsupported` on Windows. Tag is `v0.48.2`, so the banner version is not a lie.
- No issue: pull upstream regularly (`git fetch upstream`, merge on a branch as in #35).
- Parked: send the security fixes upstream to AltanS/collie.
- Parked: #55 ACL follow-up (see above).

## Watch out for

- **Restarting can lock the config dir.** `Protect-CollieSecret` on the directory + `/inheritance:r`
  without object/container inherit left `exec-bridge.vbs` with no ACEs. If start fails with access
  denied there, `icacls <file> /grant:r "$env:USERDOMAIN\$env:USERNAME:(F)"` on every file in
  `%APPDATA%\herdr\plugins\config\herdr.collie\`, then `collie-ctl.ps1 start`. Do not
  `taskkill /IM bun.exe`.
- **Raw terminal on means no prompt buttons and no idle-tail / commands-only collapse.** 0.45.0
  default. Grammar / hide-live bugs need ⚙ → Raw terminal off.
- **Do not trust an ADW's own success line.** The denylist rolls back named files, but still
  read the diff's file list against Out of scope.
- **The source being right tells you nothing about what the phone runs.** `/api/config` → `build`
  is the commit being served; `staleBuild` is the mtime guard. Local curl gets `identity required`.
- **`run_quality()` publishes `web/dist`.** SDLC inner loop (`run_tests()`) does not build.
- **`adws/adw_modules/` is protected_files.** An ADW cannot implement factory-gate changes.
- **PATH's `bash` is the WSL stub.** Use `C:\Program Files\Git\bin\bash.exe`.
- **CI has no `uv`.** A test that shells out to `uv` will pass here and fail on GitHub.
- Never `taskkill /IM bun.exe`.
- If `AGENTS.md` or `GEMINI.md` reappear, delete them. `CLAUDE.md` is the working agreement.
