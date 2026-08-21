# Next session

_Last handoff: 2026-08-21 — `main` at **0.48.2** (`0a3a128`). Latest tag is still `v0.46.2` — 0.47.0 through 0.48.2 are untagged.
Bridge: `C:\claudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`. **Rebuilt and restarted earlier this session** — `web/dist` is `0.48.2+0a3a128-dirty` (dirty = untracked files under `adws/adw_data/`, leave them). One listener on `:8787`._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

**Smart wrap is on the phone and works** (0.48.2, PR #101). Then a code review of PR #94 (#69 out-of-scope quality gate): do **not** merge it. The check is in the wrong layer (quality block after the suites, instead of a permissions denylist that rolls the file back). CI is also red (`uv` not on the runner). Specs for the replacement are issues #103–#106.

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
`web/dist`. Factory tests: `PYTHONPATH=adws python3 -m unittest adw_modules.test_out_of_scope` —
not `uv`, not `bun test`.

## Next thing to do

1. **Hand-edit #103 + #104 + #106 together** (one branch off current `main`). `adws/adw_modules/` is `protected_files` — not an ADW. Denylist in `permissions.enforce()`, path-list contract, fail closed. Specs are on the issues. No Collie version bump (factory code). Close #69 and PR #94 without merging #94 when this lands.
2. **#105** is independent: never add a Bun test under scripts/ that spawns the factory unittest (that is what red-CI'd PR #94). If you want factory tests in CI, a separate `python3` job, not bun wrapping `uv`.
3. **Tag the untagged releases, or at least `v0.48.2`.** Code on main is 0.48.2; newest tag is `v0.46.2`, so the in-app update banner is lying.
4. **Close stale docs PR #98** (`docs/handoff-0.47.0`) — this note supersedes it.

## Open

- **#103** — out-of-scope is a permissions denylist, not a quality block. The #69 fix.
- **#104** — names are paths; naming a file forbids every edit. Same hand-edit as #103.
- **#106** — fail closed when the request cannot be read. Same hand-edit as #103.
- **#105** — factory tests: `python3 -m unittest`, never bun/`uv`.
- **#69** — stays open until #103 lands.
- **PR #94** — close without merging. Comments point at #103–#106.
- **PR #98** — stale NEXT-SESSION for 0.47.0. Close it.
- No issue: in-app update banner tells you to run the Herdr `update` action, which is
  `platform_unsupported` on Windows.
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
- Tag every release. Code is 0.48.2; tag is still `v0.46.2`.
- Never `taskkill /IM bun.exe`.
- If `AGENTS.md` or `GEMINI.md` reappear, delete them. `CLAUDE.md` is the working agreement.
