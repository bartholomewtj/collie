# Next session

_Last handoff: 2026-08-21 — `main` at **0.47.0** (PR #97 merged, **not tagged**).
Bridge: `C:\claudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`. One listener on `:8787`.
`web/dist` is `0.47.0+747291d-dirty` — an ADW-era build, **not** HEAD `7043757`. Rebuild before
trusting the phone._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

**0.47.0 is on main, untagged, not rebuilt.** Live-only pane shipped in #97 (`adw_simple_sdlc`
`216a62f1`). The pane is the live CLI viewport only — no transcript stacked above the tail, no Live
seam, no hiding the TUI when idle. History button stays; `/pane/:id/history` is still the parsed
conversation and now refreshes in place (status change + 30s while working; scrolled-up readers keep
their place; `/clear` replaces the log). `use-inline-history` and `transcript-seam` are gone.

`commit_build` only landed `agent-chat.tsx` (last revise envelope). The rest of the build is in
`64b809d`. Don't trust an ADW success line's file list.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main; untracked adws/adw_data/* is fine
git describe --tags --abbrev=0                        # still v0.46.2 until you tag
netstat -ano | findstr :8787                          # expect ONE listener
```

The phone is **not** on HEAD until you `bun run build` then `collie-ctl.ps1 restart`. Do that before
checking History-live or the live-only pane on device.

Tests: `bun run test` (root) and `cd web && bun run test`. ADW inner loop: `run_tests()` in
`adws/adw_modules/quality.py`. Do **not** run `run_quality()` casually — `build` rewrites live
`web/dist`.

## Next thing to do

1. **Tag `v0.47.0` and rebuild.** `git tag -a v0.47.0 -m "Collie 0.47.0" && git push origin v0.47.0`,
   then `bun run build` and `contrib/windows/collie-ctl.ps1 restart`. Confirm `/api/config` `build`
   is `0.47.0+7043757` (or the merge sha), not `747291d-dirty`.
2. **Fix PR #94 CI, rebase onto main, bump to 0.47.1, then merge.** Spawn
   `python`/`python3 -m unittest adw_modules.test_out_of_scope` instead of `uv`. Closes #69.
3. **On the phone after restart:** History button still there; History gains new turns without
   leaving; swipe-up on the pane does **not** show chat. A blocked space should not jump (unverified
   from earlier). There is no hidden live tail anymore — ignore any old note that says otherwise.

## Open

- **PR #94** — #69 out-of-scope quality gate. CI red (`uv` missing on the runner). Written as
  PATCH 0.46.3; main is 0.47.0, so rebase and bump to **0.47.1**.
- **#69** — open until #94 merges.
- No issue: in-app update banner tells you to run the Herdr `update` action, which is
  `platform_unsupported` on Windows.
- No issue: pull upstream regularly (`git fetch upstream`, merge on a branch as in #35).
- Parked: send the security fixes upstream to AltanS/collie.

## Watch out for

- **The pane never hides the live TUI now.** Raw terminal on still means no prompt buttons (⚙ → Raw
  terminal off to get grammars). It does **not** mean a collapsed tail — that code is deleted.
- **Restarting can lock the config dir.** `Protect-CollieSecret` on the directory + `/inheritance:r`
  without object/container inherit left `exec-bridge.vbs` with no ACEs. If start fails with access
  denied there, `icacls <file> /grant:r "$env:USERDOMAIN\$env:USERNAME:(F)"` on every file in
  `%APPDATA%\herdr\plugins\config\herdr.collie\`, then `collie-ctl.ps1 start`. Do not
  `taskkill /IM bun.exe`. Optional follow-up: grant `(OI)(CI)(F)` or only harden `.env`.
- **Do not trust an ADW's own success line.** Read the diff's file list against Out of scope.
  `commit_build` stages `paths_touched` from the *last* builder envelope — a revise can drop the
  rest of the build from the commit.
- **Gemini 3.7 flash on OpenRouter 429s**, then retries hit Google AI Studio with "Corrupted thought
  signature" and the session is dead. Resume with `--adw-id`; a failed builder is not in
  `agent_map.json`, so the next builder is a fresh session.
- **The source being right tells you nothing about what the phone runs.** `/api/config` → `build`
  is the commit being served; `staleBuild` is the mtime guard. Local curl gets `identity required`.
- **`run_quality()` publishes `web/dist`.** SDLC inner loop (`run_tests()`) does not build.
- **`adws/adw_modules/` is protected_files.** An ADW cannot implement factory-gate changes.
- **PATH's `bash` is the WSL stub.** Use `C:\Program Files\Git\bin\bash.exe`.
- **CI has no `uv`.** A test that shells out to `uv` will pass here and fail on GitHub.
- Tag every release. Current tag: `v0.46.2`. Code: `0.47.0`.
- Never `taskkill /IM bun.exe`.
- If `AGENTS.md` or `GEMINI.md` reappear, delete them. `CLAUDE.md` is the working agreement.
