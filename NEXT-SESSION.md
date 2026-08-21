# Next session

_Last handoff: 2026-08-21 — `main` at **0.48.2** (`0a3a128`), tagged **v0.48.2**.
Bridge: `C:\claudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`. `web/dist` is `0.48.2+0a3a128-dirty` (dirty = untracked files under `adws/adw_data/`, leave them). One listener on `:8787`._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

Smart wrap is on the phone (0.48.2, PR #101). Code review of PR #94: do **not** merge — wrong layer, red CI, stale 0.46.3 bump. Replacement specs filed as #103–#106. Tagged `v0.48.2`; GitHub release is live. PR #98 closed.

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
`web/dist`. Factory tests: `PYTHONPATH=adws python3 -m unittest adw_modules.test_out_of_scope` —
not `uv`, not `bun test`.

## Next thing to do

1. **Hand-edit #103 + #104 + #106 together** (one branch off current `main`). `adws/adw_modules/` is `protected_files` — not an ADW. Denylist in `permissions.enforce()`, path-list contract, fail closed. Specs are on the issues. No Collie version bump (factory code). Close #69 and close PR #94 without merging when this lands.
2. **#105** is independent: never add a Bun test under scripts/ that spawns the factory unittest. If you want factory tests in CI, a separate `python3` job, not bun wrapping `uv`.
3. Merge this docs PR (#102) if it is still open.

## Open

- **#103** — out-of-scope is a permissions denylist, not a quality block. The #69 fix.
- **#104** — names are paths; naming a file forbids every edit. Same hand-edit as #103.
- **#106** — fail closed when the request cannot be read. Same hand-edit as #103.
- **#105** — factory tests: `python3 -m unittest`, never bun/`uv`.
- **#69** — stays open until #103 lands.
- **PR #94** — close without merging. Comments point at #103–#106.
- **PR #102** — this handoff. Merge it.
- No issue: in-app update banner tells you to run the Herdr `update` action, which is
  `platform_unsupported` on Windows. Tag is now `v0.48.2`, so the banner version is no longer a lie.
- No issue: pull upstream regularly (`git fetch upstream`, merge on a branch as in #35).
- Parked: send the security fixes upstream to AltanS/collie.
- Parked: #55 follow-up — `Protect-CollieSecret` on the config dir must not strip child ACLs
  (`(OI)(CI)(F)` or skip the directory and only harden `.env`).

## Watch out for

- **Do not merge PR #94.** Wrong layer, red CI, stale 0.46.3 bump on 0.48.2.
- **Restarting can lock the config dir.** `Protect-CollieSecret` on the directory + `/inheritance:r`
  without object/container inherit left `exec-bridge.vbs` with no ACEs. If start fails with access
  denied there, `icacls <file> /grant:r "$env:USERDOMAIN\$env:USERNAME:(F)"` on every file in
  `%APPDATA%\herdr\plugins\config\herdr.collie\`, then `collie-ctl.ps1 start`. Do not
  `taskkill /IM bun.exe`.
- **Raw terminal on means no prompt buttons and no idle-tail / commands-only collapse.** 0.45.0
  default. Grammar / hide-live bugs need ⚙ → Raw terminal off.
- **Do not trust an ADW's own success line.** Read the diff's file list against Out of scope.
- **The source being right tells you nothing about what the phone runs.** `/api/config` → `build`
  is the commit being served; `staleBuild` is the mtime guard. Local curl gets `identity required`.
- **`run_quality()` publishes `web/dist`.** SDLC inner loop (`run_tests()`) does not build.
- **`adws/adw_modules/` is protected_files.** An ADW cannot implement factory-gate changes. #103–#106 are hand-edits.
- **PATH's `bash` is the WSL stub.** Use `C:\Program Files\Git\bin\bash.exe`.
- **CI has no `uv`.** A test that shells out to `uv` will pass here and fail on GitHub.
- Never `taskkill /IM bun.exe`.
- If `AGENTS.md` or `GEMINI.md` reappear, delete them. `CLAUDE.md` is the working agreement.
