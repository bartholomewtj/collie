# Next session

_Last handoff: 2026-08-21 — `main` at **0.46.2** (`v0.46.2` tagged). No open PRs.
Bridge: `C:\claudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`. Last **restarted at
0.42.0**. This drop touches both `web/` and `bridge/` — `bun run build` then `collie-ctl.ps1 restart`._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

Merged the stacked ADW PRs onto `main` and tagged **0.46.2**:

- **0.45.1 (#87 / #82)** — Spaces tree keeps Herdr order. No recency jumps, no blocked-first lift.
- **0.46.0 (#89 / #78)** — `working` splits: amber = thinking, blue `runningCommand` = a tool with no
  result yet. Commands-only hides the live tail (Show live still pins it). Journal tail on the
  snapshot poll; `cfg.transcript` off stays amber.
- **0.46.1 (#90 / #55)** — Windows `.env` uses icacls (inheritance off, current user Full Control).
  Git Bash no longer warns mode 644. POSIX chmod path unchanged.
- **0.46.2 (#91 / #68)** — pre-push runs `bun test ./bridge ./scripts`. Typecheck-in-test was already
  0.41.1; this was the leftover gate gap.
- **#60** closed: security-fix suite retest on `main` was green (792 pass / 0 fail backend, 2628 web).
- **#86** merged: docs match raw-terminal-as-default (0.45.0). **#84** closed as a stale 0.44.0 note.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main, clean
git describe --tags --abbrev=0                        # expect v0.46.2 (tag sits on the release, not this docs commit)
netstat -ano | findstr :8787                          # expect ONE listener
```

```powershell
bun run build                                              # web/ changed — live, no restart
powershell -File contrib\windows\collie-ctl.ps1 restart    # bridge/ changed
```

Tests: `bun run test` (root) and `cd web && bun run test`. ADW inner loop: `run_tests()` in
`adws/adw_modules/quality.py`. Do **not** run `run_quality()` casually — `build` rewrites live
`web/dist`.

## Next thing to do

1. **Rebuild + restart** so the phone is on 0.46.2: `bun run build`, then `collie-ctl.ps1 restart`.
   Confirm a blocked space does not jump, and a long `npm install` is a blue dot with the live tail
   hidden (grammars off — raw terminal on keeps the tail).
2. **#69 stays parked** until there is a design that does not edit `adws/adw_modules/`
   (`permissions.py` / `quality.py` are `protected_files`).
3. Nothing else is queued. Product leftovers without issues: Windows update-banner still names the
   Herdr `update` action (`platform_unsupported` here); README screenshots may still show old screens.

## Open

- **#69** — ADW agents can rewrite files the request put out of scope. Parked: no design, needs
  protected factory files.
- No issue: in-app update banner tells you to run the Herdr `update` action, which is
  `platform_unsupported` on Windows.
- No issue: pull upstream regularly (`git fetch upstream`, merge on a branch as in #35).
- Parked: send the security fixes upstream to AltanS/collie.

## Watch out for

- **Raw terminal on means no prompt buttons and no idle-tail / commands-only collapse.** 0.45.0
  default. Grammar / hide-live bugs need ⚙ → Raw terminal off.
- **Do not trust an ADW's own success line.** Read the diff's file list against the request's Out of
  scope. (#60, #69.)
- **The source being right tells you nothing about what the phone runs.** Bridge serves `web/dist`.
  `/api/config` → `build` is the commit being served, `staleBuild` is the mtime guard (30s cache).
- **`run_quality()` publishes `web/dist`.** SDLC inner loop (`run_tests()`) does not build.
- **`quality.py` is protected_files.** An ADW cannot implement factory-gate changes.
- **PATH's `bash` is the WSL stub.** Tests resolve Git bash. Use `C:\Program Files\Git\bin\bash.exe`.
- Tag every release. Untagged = invisible to the phone. Current: `v0.46.2`.
- Never `taskkill /IM bun.exe` — it takes the live bridge and every agy run with it.
- If `AGENTS.md` or `GEMINI.md` reappear, an agent tool wrote them. Delete. `CLAUDE.md` is the
  working agreement.
