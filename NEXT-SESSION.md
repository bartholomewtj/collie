# Next session

_Last handoff: 2026-08-21 — `main` at **0.46.2** (`v0.46.2` tagged). One open PR.
Bridge: `C:\claudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`. **Rebuilt and restarted
this session** — `web/dist` is `0.46.2-dev+0e54405-dirty` (dirty = untracked files under
`adws/adw_data/`, leave them). One listener on `:8787`._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

**0.46.2 is on main, tagged, built, and running.** Stacked ADW PRs #87/#89/#90/#91 landed. #60
closed after a green security-suite retest. `bun run build` then `collie-ctl.ps1 restart` done.

Restart hit a **#55 regression**: `Protect-CollieSecret` on the config *directory* ran
`icacls /inheritance:r` and left `exec-bridge.vbs`, logs, and pid with empty DACLs. Stop
succeeded; start failed (`Set-Content` access denied on the VBS). Restored `BART\barth:(F)` on
every file in that dir, then `start` worked. Files now have explicit Full Control, so a later
restart should survive. The code still only grants `(F)` on the dir itself (no `(OI)(CI)`), so
*new* files in that dir can still be orphaned.

**#69 is implemented but not merged.** PR https://github.com/bartholomewtj/collie/pull/94
(`fix/69-out-of-scope-gate`, PATCH 0.46.3). CI is red: the bun test that drives the parser spawns
`uv`, which GitHub Actions does not have (`Executable not found in $PATH: "uv"`). Local `bun test`
was green. Hand-edited `adws/adw_modules/` (the grader — an ADW must not write it).

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main; untracked adws/adw_data/* is fine
git describe --tags --abbrev=0                        # expect v0.46.2
netstat -ano | findstr :8787                          # expect ONE listener
```

Do **not** rebuild/restart unless `web/dist/build-info.json` is behind `main` or the bridge is down.

Tests: `bun run test` (root) and `cd web && bun run test`. ADW inner loop: `run_tests()` in
`adws/adw_modules/quality.py`. Do **not** run `run_quality()` casually — `build` rewrites live
`web/dist`.

## Next thing to do

1. **Fix PR #94 CI, then merge.** Spawn `python`/`python3 -m unittest adw_modules.test_out_of_scope`
   instead of `uv`. After green: merge, tag `v0.46.3`, close #69.
2. **Confirm on the phone** that a blocked space does not jump, and a long `npm install` is a blue
   dot with the live tail hidden (grammars off — raw terminal on keeps the tail).
3. **#55 follow-up if you want it:** `Protect-CollieSecret` on the config dir must not strip child
   ACLs. Either skip the directory (only harden `.env`) or grant `(OI)(CI)(F)` so children inherit.
   Discovered when `restart` broke the live bridge.

## Open

- **PR #94** — #69 out-of-scope quality gate. Waiting on a CI fix (`uv` not on the runner).
- **#69** — open until #94 merges.
- No issue: in-app update banner tells you to run the Herdr `update` action, which is
  `platform_unsupported` on Windows.
- No issue: pull upstream regularly (`git fetch upstream`, merge on a branch as in #35).
- Parked: send the security fixes upstream to AltanS/collie.

## Watch out for

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
- **`adws/adw_modules/` is protected_files.** An ADW cannot implement factory-gate changes.
- **PATH's `bash` is the WSL stub.** Use `C:\Program Files\Git\bin\bash.exe`.
- **CI has no `uv`.** A test that shells out to `uv` will pass here and fail on GitHub.
- Tag every release. Current: `v0.46.2`.
- Never `taskkill /IM bun.exe`.
- If `AGENTS.md` or `GEMINI.md` reappear, delete them. `CLAUDE.md` is the working agreement.
