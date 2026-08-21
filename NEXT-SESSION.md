# Next session

_Last handoff: 2026-08-21 — `main` at **0.49.0** (`1cc2397`). Tag is still **v0.48.2** until you
cut `v0.49.0`. Bridge: `C:\claudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`.
`web/dist` is still `0.48.2+0a3a128-dirty` — rebuild if you want 0.49.0 on the phone. One listener
on `:8787`._

Fork of [AltanS/collie](https://github.com/AltanS/collie). Plugin id `herdr.collie`.
Balanced roster: `adws/adw_sssf_config/sssf.config.yaml` (pi/OpenRouter, metered).

## Where this stopped

#111 merged. Item 6 from the upstream take-list: `keys.toml` (Keys tray Presets, ADR 0018, grok on
the scope ladder), F1–F12, and a failed empty fetch says Disconnected dated by the data on screen.
Not a full upstream merge. Quick replies and fail-closed gates untouched.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main; untracked adws/adw_data/* is fine
git describe --tags --abbrev=0                        # still v0.48.2 until you tag
netstat -ano | findstr :8787                          # expect ONE listener
```

To put 0.49.0 on the phone: `bun run build`, reopen the PWA, then
`git tag -a v0.49.0 -m "Collie 0.49.0" && git push origin v0.49.0`.
Copy `keys.toml.example` next to `.env` if you want custom Key presets.

Tests: `bun run test` (root) and `cd web && bun run test`. ADW inner loop: `run_tests()` in
`adws/adw_modules/quality.py`. Do **not** run `run_quality()` casually — `build` rewrites live
`web/dist`. Factory tests (not `uv`, not `bun test`):

```bash
PYTHONPATH=adws python -m unittest adw_modules.test_out_of_scope adw_modules.test_permissions
```

CI runs those as the `factory unittests` job, separate from `bun run test`.

## Next thing to do

1. Tag `v0.49.0` and rebuild if you want it on the phone. Otherwise leave `web/dist` as 0.48.2.
2. Remaining upstream (inspect, do not merge the 45 as a blob): offline cache (`last-seen.ts`),
   `--major` update gate on top of ADR 0019 + this-fork tags. Skip a re-port of 0.30–0.31.1.
3. Parked: #55 ACL follow-up; Windows `update` action is `platform_unsupported`.

## Open

- No issue: tag `v0.49.0` when you ship it. Banner still points at `v0.48.2` until then.
- No issue: leftover upstream (last-seen / `--major`). Cherry-pick, do not `git merge upstream/main`.
- Parked: send the security fixes upstream to AltanS/collie.
- Parked: #55 ACL follow-up (`Protect-CollieSecret` on the config dir can strip child ACLs).

## Watch out for

- **Restarting can lock the config dir.** `Protect-CollieSecret` on the directory + `/inheritance:r`
  without object/container inherit left `exec-bridge.vbs` with no ACEs. If start fails with access
  denied there, `icacls <file> /grant:r "$env:USERDOMAIN\$env:USERNAME:(F)"` on every file in
  `%APPDATA%\herdr\plugins\config\herdr.collie\`, then `collie-ctl.ps1 start`. Do not
  `taskkill /IM bun.exe`.
- **Raw terminal on means no prompt buttons and no idle-tail / commands-only collapse.** 0.45.0
  default. Grammar / hide-live bugs need ⚙ → Raw terminal off.
- **Do not trust an ADW's own success line.** The denylist rolls back named files, but still
  read the diff's file list against Out of scope.
- **The source being right tells you nothing about what the phone runs.** `/api/config` → `build`
  is the commit being served; `staleBuild` is the mtime guard. Local curl gets `identity required`.
- **`run_quality()` publishes `web/dist`.** SDLC inner loop (`run_tests()`) does not build.
- **`adws/adw_modules/` is protected_files.** An ADW cannot implement factory-gate changes.
- **PATH's `bash` is the WSL stub.** Use `C:\Program Files\Git\bin\bash.exe`.
- **CI has no `uv`.** Factory tests go through the `factory unittests` job, not `bun test`.
- **Do not `git merge upstream/main`.** Git still thinks you split at 0.29.0. Port leftovers only.
- Never `taskkill /IM bun.exe`.
- If `AGENTS.md` or `GEMINI.md` reappear, delete them. `CLAUDE.md` is the working agreement.
