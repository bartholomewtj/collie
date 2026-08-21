# Next session

_Last handoff: 2026-08-21 — `main` at **0.51.0** (`353f85c`), tagged **v0.51.0**.
Bridge: `C:\claudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`. `web/dist` is
`0.51.0+353f85c-dirty` (dirty = untracked files under `adws/adw_data/`, leave them). One listener
on `:8787`._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

0.51.0 is tagged, rebuilt, and restarted. #114 last-seen + `--major` (ADR 0025), #115 config-dir
`(OI)(CI)` ACLs, #116 Herdr actions via `build/collie-action-v1.exe`. Phone: hard-refresh / reopen
the PWA. `herdr plugin action invoke update --plugin herdr.collie` works on this box.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main; untracked adws/adw_data/* is fine
git describe --tags --abbrev=0                        # expect v0.51.0
netstat -ano | findstr :8787                          # expect ONE listener
```

Do **not** rebuild/restart unless `web/dist/build-info.json` is behind `main` or the bridge is down.
Phone must hard-refresh / reopen the PWA after a rebuild.

Tests: `bun run test` (root) and `cd web && bun run test`. ADW inner loop: `run_tests()` in
`adws/adw_modules/quality.py`. Do **not** run `run_quality()` casually — `build` rewrites live
`web/dist`. Factory tests (not `uv`, not `bun test`):

```bash
PYTHONPATH=adws python -m unittest adw_modules.test_out_of_scope adw_modules.test_permissions
```

CI runs those as the `factory unittests` job, separate from `bun run test`.

## Next thing to do

1. Parked: send this fork's security fixes upstream to AltanS/collie.
2. Parked: `push-keys` / `push-test` Herdr actions are still POSIX-only (the Windows ctl has no
   wrappers; PATH's bash is the WSL stub).
3. Do not `git merge upstream/main`. Inspect leftovers; skip a re-port of 0.30–0.31.1.

## Open

- Parked: send the security fixes upstream to AltanS/collie.
- Parked: Windows `push-keys` / `push-test` Herdr actions.

## Watch out for

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
