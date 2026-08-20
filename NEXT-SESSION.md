# Next session

_Last handoff: 2026-08-20 — `main` at **0.44.0** (`v0.44.0` tagged and pushed). No open PRs.
Bridge: `C:\claudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`. Last **restarted at
0.42.0** — the phone still needs `collie-ctl.ps1 update` to pick up this tag._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

**0.44.0 is on main and tagged.** Idle panes hide the live TUI when the transcript already holds
the newest turn (#77). Show live peels it back. Working / blocked / dialog / find / lagging
journal keep it.

Also landed this session, stacked then merged:

| PR | What |
|---|---|
| #79 | `check-doc-links.test.ts` uses Git bash on Windows, not the WSL stub. PATCH 0.43.2. **#66 closed.** |
| #80 | Release cut 0.44.0. |
| #81 | `quality.py` split: `run_tests()` = typecheck_bridge, typecheck_web, test_bridge, test_web. `run_quality()` adds versions, version_bump, test_ctl, **build**. Each failure keeps its own 4k tail. Factory, no bump. |
| #83 | README screenshots are the Spaces tree. **#70 closed.** No blocked space on the herd; Grok-working is the expanded row. |

`adws/adw_modules/quality.py` is **protected_files** — an ADW builder cannot edit it. The split was
committed by the operator; the ADW wrote spec + docs. This run's own gate was 4/4 on the new blocks.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main, clean
git describe --exact-match HEAD                      # expect v0.44.0
netstat -ano | findstr :8787                          # expect ONE listener
```

```powershell
powershell -File contrib\windows\collie-ctl.ps1 update    # pull v0.44.0, build, restart
powershell -File contrib\windows\collie-ctl.ps1 restart   # after a bridge/*.ts change (no rebuild)
bun run build                                             # after a web/ change — live, no restart
```

Tests: `bun run test` (root) and `cd web && bun run test`. ADW inner loop: `run_tests()` in
`adws/adw_modules/quality.py`. Do **not** run `run_quality()` casually — `build` rewrites live
`web/dist`.

## Next thing to do

1. **Update the live bridge** (`collie-ctl.ps1 update`). Process is still the 0.42.0 restart; footer
   said "Bridge restart needed" while shooting #70.
2. **#78 — commands-running vs thinking.** Blue dot + hide the live tail while a tool is running and
   the model has stopped generating. Ship the live-tail half first (`transcript-seam.ts` /
   `agent-chat.tsx`); the dashboard dot needs a poll-loop journal tail. Signal already exists:
   `pendingTools` / a tool part with `result === undefined`.
3. **#82 — stop reordering the Spaces tree.** Drop recency sort and blocked-first regroup; keep the
   badge, don't move the row. `space-tree.tsx` + `sortSpacesByRecency`.

## Open

- **#82** — sidebar list should stay put; attention in place, not by jumping rows.
- **#78** — split commands-running from thinking (blue dot + hide live).
- **#69** — ADW agents can rewrite files the request put out of scope; nothing stops them. Hit
  this session: the 0.44.0 builder edited `check-doc-links.test.ts` (out of scope) trying to
  paper over the WSL-bash failures.
- **#68** — typecheck-in-`bun run test` landed in 0.41.1. Leftover: other gates that report green
  while checking less than they appear to.
- **#60** — placeholders gone (0.43.1 + #81 split). Other half stands: the security fixes from
  those earlier runs were **never actually tested**.
- **#55** — Windows `.env` is mode 644; ctl warns every run; needs an `icacls` path.
- No issue: in-app update banner tells you to run the Herdr `update` action, which is
  `platform_unsupported` on Windows.
- No issue: pull upstream regularly (`git fetch upstream`, merge on a branch as in #35).
- Parked: send the security fixes upstream to AltanS/collie.

## Watch out for

- **Do not trust an ADW's own success line.** Pre-0.43.1, phase 04 was a placeholder and committed
  34 files, including an out-of-scope rewrite of `routes/detail.tsx` that crashed every pane. Read
  the diff's file list against the request. (#60, #69.)
- **The source being right tells you nothing about what the phone runs.** Bridge serves `web/dist`.
  `/api/config` → `build` is the commit being served, `staleBuild` is the mtime guard (30s cache).
- **`run_quality()` publishes `web/dist`.** That is the live PWA on this checkout. SDLC inner loop
  (`run_tests()`) does not build.
- **`quality.py` is protected_files.** An ADW cannot implement factory-gate changes. Operator
  commits that file; ADW does spec/docs.
- **Put the version bump in the ADW request**, or finish the commit yourself. `SKIP_VERSION_CHECK=1`
  is the escape hatch. `git describe --exact-match HEAD` after any ADW — if it errors, main is past
  its newest tag.
- **ADW cost lines read `$0.0000` and are false.** Real spend is on openrouter.ai.
- **Never edit the checkout while an ADW is running.** One session per checkout.
- **chrome-agent one-shot is a new CDP session every call.** `Network.setExtraHTTPHeaders` and
  `Fetch.enable` do not persist. Identity header on this PWA needs one long-lived websocket to
  port 9222 (see local `adws/adw_data/shot_tree.ts`, not in git). Headless Chrome `--screenshot`
  of a :8790 proxy hung in a GCM loop for 10+ min — kill that tree, never `taskkill /IM bun.exe`.
- **PATH's `bash` is the WSL stub** (`C:\Windows\System32\bash.exe`, no distro). Tests now resolve
  Git bash. Survey scripts need `C:\Program Files\Git\bin\bash.exe`, not `bash`.
- Tag every release. Untagged = invisible to the phone. Current: `v0.44.0`.
- SSSF discovery `MAX_DOWN` is 3 (`bridge/sssf-viz.ts`). Deeper than that, traces vanish with no error.
- Ctl "cannot reach Herdr" after start is a false alarm. Check `collie.log` for `[events] stream up`.
- Git Bash eats backslashes in hook paths. Use forward slashes.
- Windows checkout is CRLF except `scripts/*.sh` (LF in `.gitattributes`).
- If `AGENTS.md` or `GEMINI.md` reappear, an agent tool wrote them. Delete. `CLAUDE.md` is the
  working agreement.
- Never `taskkill /IM bun.exe` — it takes the live bridge and every agy run with it.
- Stacked PRs: retarget to `main` before merging the base, then merge, then delete. This session
  merged #79→#80→#81→#83 onto `main` without retarget and GitHub accepted it; don't rely on that.
