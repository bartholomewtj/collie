# Next session

_Main at **0.55.2** (`4456a30`); tags v0.55.1 / v0.55.2 may still need pushing (see Open); Windows host `C:\ClaudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`, `COLLIE_WORK_ROOT=C:\claudeos`, one listener on `:8787`._

## Where this stopped

Repo cleanup landed 2026-08-22 as #136 (factory litter untracked), #138 (one orientation doc, 0.55.1) and #139 (`bridge/server.ts` split into route-group modules, 0.55.2). All merged; branches deleted. Phases 1–3 were run as ADWs; phase 4 ran three times before passing (scope-gate wording, see #137 and the claudeSSSF prompting cookbook).

**The bridge has not been restarted on 0.55.2.** Restart it (`collie-ctl.ps1 restart`) before trusting any bridge behaviour; the split touched every route.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main; untracked adws/adw_data/* is fine
git describe --tags --abbrev=0                        # expect v0.55.2
netstat -ano | findstr :8787                          # expect ONE listener
```

Do **not** rebuild just to clear the dist stamp. Rebuild only if a UI bug will not reproduce.
Phone must hard-refresh / reopen the PWA after a rebuild.

Tests: `bun run test` (root) and `cd web && bun run test`. ADW inner loop: `run_tests()` in
`adws/adw_modules/quality.py`. Do **not** run `run_quality()` casually — `build` rewrites live
`web/dist`. Factory tests (not `uv`, not `bun test`):

```bash
PYTHONPATH=adws python -m unittest adw_modules.test_out_of_scope adw_modules.test_permissions
```

## Open

- Tags `v0.55.1` (`5b6b4ed`) and `v0.55.2` (`4456a30`) — create and push if `git tag` does not show them.
- Four stale unmerged branches still exist (`chore/release-0.44.0`, `docs/handoff-0.47.0`, `docs/handoff-2026-08-20`, `fix/69-out-of-scope-gate`, the last three also on origin). Bart decided to delete them; the session could not (`-D` blocked).
- #137: ADW commit phase fails on builder-staged deletions and on the version-bump pre-commit; phases 2–4 were committed by hand.
- README trim in #138 was modest; a harder cut is a follow-up if wanted.
- Parked: send this fork's security fixes upstream to `AltanS/collie`.
- Parked: Windows `push-keys` / `push-test` Herdr actions are POSIX-only.

## Watch out for

- Planner is Claude Code **opus**, not OpenRouter; the other seats are pi.
- `collie-ctl.ps1 status` can warn falsely; trust `[events] stream up` in the log.
- Herdr rejects duplicate action ids; canonical Windows actions use the exe and POSIX twins are `*-posix`.
- PATH's `bash` is the WSL stub; use Git Bash. Windows Herdr actions must not call `bash`.
- If an ACL/file lock blocks recovery, grant the file with `icacls`, then start; never `taskkill /IM bun.exe`.
- `/api/config` → `build` is what the phone runs; `staleBuild` means rebuild `web/dist`.
- `run_quality()` publishes `web/dist`; `run_tests()` does not build.
- `adws/adw_modules/` is protected; CI has no `uv`.
- Do not `git merge upstream/main`.
- `CLAUDE.md` is the working agreement **and** the system map. `CONTEXT.md` is gone — don't recreate it. If `AGENTS.md` or `GEMINI.md` reappear, delete them.
