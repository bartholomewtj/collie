# Next session

_Main at **0.55.0** / **v0.55.0**; Windows host `C:\ClaudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`, `COLLIE_WORK_ROOT=C:\claudeos`, one listener on `:8787`._

## Where this stopped

Files tab shipped on `main`. PR #136 (`chore/cleanup-2-litter`) is open; this docs cleanup is on `chore/cleanup-3-docs` and its PR follows.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main; untracked adws/adw_data/* is fine
git describe --tags --abbrev=0                        # newest tag is v0.55.0
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

- PR #136: stop tracking factory litter and drop shipped planning docs.
- This docs cleanup PR on `chore/cleanup-3-docs`, after #136.
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
