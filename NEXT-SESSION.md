# Next session

_Last handoff: 2026-08-21 — `main` at **0.52.3**. Newest tag is still **v0.52.1** — 0.52.2
and 0.52.3 are untagged. Bridge: `C:\ClaudeOS\Projects\tools\collie`, Task Scheduler
`herdr.collie`. `web/dist` is `0.52.2+70c1bea-dirty` (stamp only — leave it). One listener
on `:8787`._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

0.52.3 is on `main` and the bridge was restarted. #122 makes Grok Conversation history per-tab:
several grok tabs in one space no longer all show the newest session's log. #121 caught README /
CONTEXT up to date. Phone: reopen the PWA if history still looks shared (bridge change, no
frontend rebuild). #120 wrap/focus and #119 console restyle are in too.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main; untracked adws/adw_data/* is fine
git describe --tags --abbrev=0                        # newest tag is v0.52.1; main is 0.52.3
netstat -ano | findstr :8787                          # expect ONE listener
```

Do **not** rebuild just to clear the 0.52.2 dist stamp. The history fix is in the bridge
(already restarted). Rebuild only if a UI bug will not reproduce. Phone must hard-refresh /
reopen the PWA after a rebuild.

Tests: `bun run test` (root) and `cd web && bun run test`. ADW inner loop: `run_tests()` in
`adws/adw_modules/quality.py`. Do **not** run `run_quality()` casually — `build` rewrites live
`web/dist`. Factory tests (not `uv`, not `bun test`):

```bash
PYTHONPATH=adws python -m unittest adw_modules.test_out_of_scope adw_modules.test_permissions
```

CI runs those as the `factory unittests` job, separate from `bun run test`.

## Next thing to do

1. Tag **v0.52.2** at `70c1bea` and **v0.52.3** at current `main`
   (`git tag -a v0.52.2 70c1bea -m "Collie 0.52.2" && git tag -a v0.52.3 -m "Collie 0.52.3" && git push origin v0.52.2 v0.52.3`).
2. Parked: send this fork's security fixes upstream to AltanS/collie.
3. Parked: `push-keys` / `push-test` Herdr actions are still POSIX-only (the Windows ctl has no
   wrappers; PATH's bash is the WSL stub).

## Open

- Tag v0.52.2 (`70c1bea`) and v0.52.3 (current main). Releases are on main, tags are not.
- Parked: send the security fixes upstream to AltanS/collie.
- Parked: Windows `push-keys` / `push-test` Herdr actions.

## Watch out for

- **Grok history is per-tab now.** Several grok panes in one space share a cwd; the adapter
  matches the live viewport to that pane's session (`bridge/journal/grok.ts`). Empty history
  on a grok tab usually means the visible screen has no distinctive user turn yet — do not
  "fix" it by picking newest.
- **`collie-ctl.ps1 status` can WARN "cannot reach Herdr" while the bridge is fine.** The probe
  hits `/api/snapshot`, which needs identity. Trust `[events] stream up` in the log, not that WARN.
- **Herdr rejects duplicate action ids.** Canonical `update` / `restart` / `update-major` are the
  Windows exe. POSIX twins are `*-posix`. Banner copy stays `invoke update`.
- **PATH's `bash` is the WSL stub.** Use `C:\Program Files\Git\bin\bash.exe`. Windows Herdr
  actions must not call `bash`.
- **Restarting can still lock a file** if an ACE is missing. Recovery:
  `icacls <file> /grant:r "$env:USERDOMAIN\$env:USERNAME:(F)"` on the file, then
  `collie-ctl.ps1 start`. Directory protect now grants `(OI)(CI)(F)` so new children inherit.
  Do not `taskkill /IM bun.exe`.
- **Raw terminal on means no prompt buttons and no idle-tail / commands-only collapse.** 0.45.0
  default. Grammar / hide-live bugs need ⚙ → Raw terminal off.
- **The live mirror always pans; there is no wrap toggle.**
- **Do not trust an ADW's own success line.** The denylist rolls back named files, but still
  read the diff's file list against Out of scope.
- **The source being right tells you nothing about what the phone runs.** `/api/config` → `build`
  is the commit being served; `staleBuild` is the mtime guard. Local curl gets `identity required`.
- **`run_quality()` publishes `web/dist`.** SDLC inner loop (`run_tests()`) does not build.
- **`adws/adw_modules/` is protected_files.** An ADW cannot implement factory-gate changes.
- **CI has no `uv`.** Factory tests go through the `factory unittests` job, not `bun test`.
- **Do not `git merge upstream/main`.** Git still thinks you split at 0.29.0. Port leftovers only.
- Never `taskkill /IM bun.exe`.
- If `AGENTS.md` or `GEMINI.md` reappear, delete them. `CLAUDE.md` is the working agreement.
