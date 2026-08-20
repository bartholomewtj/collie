# Next session

_Last handoff: 2026-08-20 — `main` at **0.45.0** (`v0.45.0` tagged and pushed). No open PRs.
Bridge: `C:\claudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`. Last **restarted at
0.42.0** — the phone still needs `collie-ctl.ps1 update` (or `bun run build` for this web-only
change) to pick up 0.45.0._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

**0.45.0 is on main and tagged (#85).** A pane opens as the **raw terminal** (plain mirror, no
tappable prompt buttons). Composer ⚙ → Display → Raw terminal off restores the grammars.
Display-prefs storage key is `v5`, so existing phones pick this up (wrap/font/tap reset).

0.44.0 (idle panes hide the live TUI when the transcript already holds the newest turn) is
underneath. Raw terminal **on** always keeps the live tail — collapse only runs with grammars on.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main, clean
git describe --exact-match HEAD                      # expect v0.45.0
netstat -ano | findstr :8787                          # expect ONE listener
```

```powershell
powershell -File contrib\windows\collie-ctl.ps1 update    # pull tag, build, restart
bun run build                                             # this change is web-only — live, no restart
```

Tests: `bun run test` (root) and `cd web && bun run test`. ADW inner loop: `run_tests()` in
`adws/adw_modules/quality.py`. Do **not** run `run_quality()` casually — `build` rewrites live
`web/dist`.

## Next thing to do

1. **Rebuild the phone UI** (`bun run build`) so 0.45.0 is what the PWA serves. Then confirm a pane
   opens as the raw TUI.
2. **#82 — stop reordering the Spaces tree.** Drop recency sort and blocked-first regroup; keep the
   badge, don't move the row. `space-tree.tsx` + `sortSpacesByRecency`.
3. **#78 — commands-running vs thinking.** Blue dot + hide the live tail while a tool is running and
   the model has stopped generating. Live-tail half first (`transcript-seam.ts` / `agent-chat.tsx`).
   With raw terminal on, hide-live does not apply — that path needs grammars off.

## Open

- **#82** — sidebar list should stay put; attention in place, not by jumping rows.
- **#78** — split commands-running from thinking (blue dot + hide live).
- **#69** — ADW agents can rewrite files the request put out of scope; nothing stops them.
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

- **Raw terminal on means no prompt buttons and no idle-tail collapse.** That is the 0.45.0 default.
  Grammar / hide-live bugs need ⚙ → Raw terminal off.
- **Do not trust an ADW's own success line.** Pre-0.43.1, phase 04 was a placeholder and committed
  34 files, including an out-of-scope rewrite of `routes/detail.tsx` that crashed every pane. Read
  the diff's file list against the request. (#60, #69.)
- **The source being right tells you nothing about what the phone runs.** Bridge serves `web/dist`.
  `/api/config` → `build` is the commit being served, `staleBuild` is the mtime guard (30s cache).
- **`run_quality()` publishes `web/dist`.** That is the live PWA on this checkout. SDLC inner loop
  (`run_tests()`) does not build.
- **`quality.py` is protected_files.** An ADW cannot implement factory-gate changes.
- **PATH's `bash` is the WSL stub.** Tests resolve Git bash. Survey scripts need
  `C:\Program Files\Git\bin\bash.exe`, not `bash`.
- Tag every release. Untagged = invisible to the phone. Current: `v0.45.0`.
- Never `taskkill /IM bun.exe` — it takes the live bridge and every agy run with it.
- If `AGENTS.md` or `GEMINI.md` reappear, an agent tool wrote them. Delete. `CLAUDE.md` is the
  working agreement.
