# Next session

_Last handoff: 2026-08-21 — `main` at **0.48.2** (`f2f42e2`), tagged **v0.48.2**.
Bridge: `C:\claudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`. `web/dist` is `0.48.2+0a3a128-dirty` (dirty = untracked files under `adws/adw_data/`, leave them). One listener on `:8787`._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

#105 is closed. Factory tests stay `python3 -m unittest` (PR #109): standing rule in both test-file docstrings, separate CI job (`setup-python` 3.12, `PYTHONPATH=adws`, pip of the ADW deps, no `uv`). No Bun wrapper under `scripts/`. App version unchanged. Do not rebuild.

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

CI runs those as the `factory unittests` job, separate from `bun run test`.

## Next thing to do

1. Pull upstream (`git fetch upstream`; AltanS/collie `main` has moved, tag `v0.32.0`, ~45 commits). Merge on a branch as in #35. Keep fail-closed Host/identity/loopback. Bump *this* fork's SemVer for the *sum*. Not an ADW.
2. Parked unless you want it: #55 follow-up — `Protect-CollieSecret` on the config dir must not strip child ACLs (`(OI)(CI)(F)` or skip the directory and only harden `.env`).
3. Parked: in-app update banner tells you to run the Herdr `update` action, which is `platform_unsupported` on Windows.

## Open

- No issue: pull upstream regularly (`git fetch upstream`, merge on a branch as in #35).
- No issue: in-app update banner points at the Herdr `update` action, `platform_unsupported` on Windows. Tag is `v0.48.2`, so the banner version is not a lie.
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
- **CI has no `uv`.** Factory tests go through the `factory unittests` job, not `bun test`.
  A test that shells out to `uv` will pass here and fail on GitHub.
- Never `taskkill /IM bun.exe`.
- If `AGENTS.md` or `GEMINI.md` reappear, delete them. `CLAUDE.md` is the working agreement.
