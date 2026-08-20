# Next session

_Last handoff: 2026-08-21 — `main` at **0.46.2** (`v0.46.2` tagged). One open PR.
Bridge: `C:\claudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`. Last **restarted at
0.42.0**. Phone UI is still an older `web/dist`._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

**0.46.2 is on main and tagged.** Stacked ADW PRs #87/#89/#90/#91 landed (sidebar order, commands-running
blue dot + hide live tail, Windows `.env` icacls, pre-push `./scripts` tests). #60 closed after a
green security-suite retest. Raw-terminal docs (#86) merged.

**#69 is implemented but not merged.** PR https://github.com/bartholomewtj/collie/pull/94
(`fix/69-out-of-scope-gate`, PATCH 0.46.3). `quality.out_of_scope` fails the ADW test phase if a
path named under `Out of scope:` is in the diff. Hand-edited `adws/adw_modules/` (the grader — an
ADW must not write it). **CI is red:** the new scripts test spawns `uv`, which is not on the
GitHub Actions runner (`Executable not found in $PATH: "uv"`). Local `bun test` was green.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main, clean
git describe --tags --abbrev=0                        # expect v0.46.2
netstat -ano | findstr :8787                          # expect ONE listener
```

```powershell
bun run build                                              # 0.46.0 web/ is not in the live dist
powershell -File contrib\windows\collie-ctl.ps1 restart    # 0.46.0 bridge/ is not in the live process
```

Tests: `bun run test` (root) and `cd web && bun run test`. ADW inner loop: `run_tests()` in
`adws/adw_modules/quality.py`. Do **not** run `run_quality()` casually — `build` rewrites live
`web/dist`.

## Next thing to do

1. **Fix PR #94 CI, then merge.** The bun test that drives the parser shells out to `uv`; CI is
   Ubuntu and has `python3`, not `uv`. Spawn `python`/`python3 -m unittest adw_modules.test_out_of_scope`
   instead. After green: merge, tag `v0.46.3`, close #69.
2. **Rebuild + restart** so the phone is on whatever `main` is: `bun run build`, then
   `collie-ctl.ps1 restart`. Confirm a blocked space does not jump, and a long `npm install` is a
   blue dot with the live tail hidden (grammars off — raw terminal on keeps the tail).
3. Product leftovers without issues: Windows update-banner still names the Herdr `update` action
   (`platform_unsupported` here); README screenshots may still show old screens.

## Open

- **PR #94** — #69 out-of-scope quality gate. Waiting on a CI fix, not on review of the idea.
- **#69** — open until #94 merges.
- No issue: in-app update banner tells you to run the Herdr `update` action, which is
  `platform_unsupported` on Windows.
- No issue: pull upstream regularly (`git fetch upstream`, merge on a branch as in #35).
- Parked: send the security fixes upstream to AltanS/collie.

## Watch out for

- **Raw terminal on means no prompt buttons and no idle-tail / commands-only collapse.** 0.45.0
  default. Grammar / hide-live bugs need ⚙ → Raw terminal off.
- **Do not trust an ADW's own success line.** Read the diff's file list against the request's Out of
  scope. After #94, the quality phase fails that class of rewrite; still read the diff.
- **The source being right tells you nothing about what the phone runs.** Bridge serves `web/dist`.
  `/api/config` → `build` is the commit being served, `staleBuild` is the mtime guard (30s cache).
- **`run_quality()` publishes `web/dist`.** SDLC inner loop (`run_tests()`) does not build.
- **`quality.py` / `adws/adw_modules/` are protected_files.** An ADW cannot implement factory-gate
  changes. #69 was hand-edited for that reason.
- **PATH's `bash` is the WSL stub.** Tests resolve Git bash. Use `C:\Program Files\Git\bin\bash.exe`.
- **CI has no `uv`.** A test that shells out to `uv` will pass here and fail on GitHub.
- Tag every release. Untagged = invisible to the phone. Current: `v0.46.2`.
- Never `taskkill /IM bun.exe` — it takes the live bridge and every agy run with it.
- If `AGENTS.md` or `GEMINI.md` reappear, an agent tool wrote them. Delete. `CLAUDE.md` is the
  working agreement.
