# Next session

_Last handoff: 2026-08-21 — `main` at **0.48.2** (`0a3a128`). Latest tag is still `v0.46.2` — 0.47.0 through 0.48.2 are untagged.
Bridge: `C:\claudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`. **Rebuilt and restarted this session** — `web/dist` is `0.48.2+0a3a128-dirty` (dirty = untracked files under `adws/adw_data/`, leave them). One listener on `:8787`._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

**Smart wrap is on the phone and works.** ADW `6eefb81b` landed 0.48.1 (clip table/box/highlight rows, strip trailing coloured pad). First phone test: table stayed on one row but the right side was cut off — clip, no pan. PR #101 (0.48.2) pans those rows instead; consecutive rows share one scroller. Merged, built, restarted. Bart confirmed a 7-column table pans with Wrap on.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main; untracked adws/adw_data/* is fine
git describe --tags --abbrev=0                        # still v0.46.2 until someone tags
netstat -ano | findstr :8787                          # expect ONE listener
```

Do **not** rebuild/restart unless `web/dist/build-info.json` is behind `main` or the bridge is down.
Phone must hard-refresh / reopen the PWA after a rebuild.

Tests: `bun run test` (root) and `cd web && bun run test`. ADW inner loop: `run_tests()` in
`adws/adw_modules/quality.py`. Do **not** run `run_quality()` casually — `build` rewrites live
`web/dist`.

## Next thing to do

1. **Tag the untagged releases, or at least `v0.48.2`.** Code on main is 0.48.2; newest tag is `v0.46.2`, so the in-app update banner is lying.
2. **Fix PR #94 CI, then merge.** Spawn `python`/`python3 -m unittest adw_modules.test_out_of_scope` instead of `uv`. After green: merge, close #69.
3. **Close stale docs PR #98** (`docs/handoff-0.47.0`) — this note supersedes it.

## Open

- **PR #94** — #69 out-of-scope quality gate. Waiting on a CI fix (`uv` not on the runner).
- **PR #98** — stale NEXT-SESSION for 0.47.0. Close it.
- **#69** — open until #94 merges.
- No issue: in-app update banner tells you to run the Herdr `update` action, which is
  `platform_unsupported` on Windows.
- No issue: pull upstream regularly (`git fetch upstream`, merge on a branch as in #35).
- Parked: send the security fixes upstream to AltanS/collie.
- Parked: #55 follow-up — `Protect-CollieSecret` on the config dir must not strip child ACLs
  (`(OI)(CI)(F)` or skip the directory and only harden `.env`).

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
- Tag every release. Code is 0.48.2; tag is still `v0.46.2`.
- Never `taskkill /IM bun.exe`.
- If `AGENTS.md` or `GEMINI.md` reappear, delete them. `CLAUDE.md` is the working agreement.
