# Next session

_Last handoff: 2026-08-20 — main at **0.40.7** (`6956110`), tags `v0.40.6` and `v0.40.7` pushed, no
open PRs. The bridge on this box is running from the **new path** (see below), supervised by the
Task Scheduler job `herdr.collie`._

Fork of [AltanS/collie](https://github.com/AltanS/collie): a phone web UI that drives the Herdr
agent herd through a Bun bridge, served over `tailscale serve`. Herdr plugin id `herdr.collie`.

## Where this stopped

**This checkout moved.** It now lives at `C:\claudeOS\Projects\tools\collie` (was
`C:\claudeOS\Projects\collie`), along with claudeSSSF, paperfetch and mediahub. Everything that
pointed at the old path was repointed: the `herdr.collie` scheduled task, Herdr's plugin registry
(`%APPDATA%\herdr\plugins.json`), and `adws/drive_issues.sh`, which now derives its own root instead
of hardcoding one. Nothing needs doing about it — it is noted because the old path appears in older
docs and session logs.

Shipped since the last handoff:

- **0.40.6** (PR #64) — agent pane cuts the transcript where the live mirror picks it up, so the
  newest message no longer reads twice. `web/src/lib/transcript-seam.ts`.
- **0.40.7** (PR #65) — **the test suites pass on Windows**, so pushes no longer need
  `SKIP_TESTS=1`. 25 backend tests were silently asserting nothing here (fixtures built paths by
  interpolating `/` while the code uses `join()`); they now run. 9 that need POSIX file modes or
  symlink privileges skip with a reason via the new `bridge/platform-support.ts` — `CAN_SYMLINK` is
  probed, not assumed. `scripts/collie-ctl.test.sh` now **refuses** to run on Windows:
  `collie-ctl.sh` delegates every verb to `contrib/windows/collie-ctl.ps1` there, so the suite was
  driving the real scheduled task and the real port. The pre-push hook runs
  `contrib/windows/collie-ctl.test.ps1` instead, so the lifecycle is still checked before every push.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main; AGENTS.md/GEMINI.md may be dirty
netstat -ano | findstr :8787                          # expect ONE listener
```

Update / restart on **this Windows box** (the Herdr `update`/`restart` plugin actions are
Linux/macOS only and answer `platform_unsupported`):

```powershell
powershell -File contrib\windows\collie-ctl.ps1 update    # pull newest v* tag, build, restart
powershell -File contrib\windows\collie-ctl.ps1 restart   # after a bridge/*.ts change (no rebuild)
bun run build                                             # after a web/ change — live, no restart
```

Tests, all green here now: `bun run test` (backend + scripts, then the ctl suite, which skips on
Windows) and `cd web && bun run test`.

## Next thing to do

1. **Decide on the two dirty files.** `AGENTS.md` is modified and `GEMINI.md` is new, neither by the
   session that wrote this note — some agent tool rewrote them. Both are wrong as they stand: their
   links `../../config/CLAUDE.md` and `../../IDENTITY.md` need one more `../` after the move, and the
   rewrite dropped `@CLAUDE.md`, the line that actually imports the rules into Claude Code. They also
   point a **public** repo at your private claudeOS layout. Fix or discard; do not commit as-is.
2. **Issue #66** — `scripts/check-doc-links.sh` prints `✗` for broken links and then exits 0, so the
   pre-commit gate blocks nothing. That is how the links in item 1 got past it. Same shape as #60.
3. **Phone: turn on push** (Settings → Push notifications), then
   `bash scripts/collie-ctl.sh push-test`. Then write your real quick replies:
   `cp commands.toml.example "$(herdr plugin config-dir herdr.collie)/commands.toml"`, uncomment the
   `[[quick]]` rows, reload.

## Open

- **#66** — doc-link gate reports failures but exits 0 (new, this session).
- **#60** — the SDLC test gate has been a placeholder for all 17 runs; the security fixes were never
  actually tested.
- **#55** — Windows `.env` is mode 644 and the ctl warns every run; needs an `icacls` path.
- Carried over, no issue filed: the in-app update banner tells you to run the Herdr `update` action,
  which fails on Windows — either add `windows` to the actions' `platforms` in `herdr-plugin.toml`
  with a ps1 command, or make the banner platform-aware.
- Carried over: pull upstream regularly (`git fetch upstream`, merge on a branch as in #35).
  Conflicts land in `README.md`, `CHANGELOG.md`, `bridge/config.ts`, `bridge/index.ts`,
  `.adr/README.md` and the nav/space files. Keep the fork's fail-closed defaults; take upstream's
  docs structure.
- Parked, your call: sending the security fixes upstream to AltanS/collie.

## Watch out for

- **Two sessions in one checkout bites, and it bit again on 2026-08-20.** A second session checked
  out its own branch mid-flight, and this session's commit landed on `main` as a result. Recovered
  with `git branch -f`, nothing lost. Check `git branch --show-current` immediately before
  committing, not just at the start. One session per checkout.
- **The version guard misfires on `--amend` and on any second commit in a branch** — it compares the
  working tree against the commit being amended, which already carries the bump.
  `SKIP_VERSION_CHECK=1` is the intended escape hatch. The house convention is functional commits
  first, then a `chore(release): x.y.z` commit citing their short hashes; 0.40.7 does not follow it
  (the bump sits inside the first commit) because the branch was already pushed.
- **Every release commit gets a `v*` tag pushed with it** (`git tag -a vX.Y.Z <sha> -m "Collie X.Y.Z"
  && git push origin vX.Y.Z`). The update banner and `update` both read tags, so an untagged release
  is invisible to the phone. 0.40.6 shipped untagged and was caught in this handoff.
- **Git Bash eats backslashes in hook paths.** `powershell.exe -File contrib\windows\x.ps1` inside a
  hook arrives as `contribwindowsx.ps1`. Use forward slashes — PowerShell accepts them.
- **Heredoc'd Python in Claude halves backslashes** — `r"[\\/]"` arrives as `[\/]`, which inside a
  regex character class silently means "just a slash". Build separators with `chr(92)`, or write the
  patch script to a file and run it.
- **The ctl's "cannot reach Herdr" warning after start/restart is a false alarm** (it probes without
  the identity header, `COLLIE_TRUSTED_USER` says 403). Check `collie.log` for `[events] stream up`.
- **Windows checkout is CRLF** (`core.autocrlf=true`) except `scripts/*.sh`, pinned LF in
  `.gitattributes`. A new shell script elsewhere needs the same pin, or CI dies on `set: pipefail\r`.
- **Skill-folder edits are not in this repo** — the SSSF visualiser (`db.ts`, `shared/types.ts`,
  `SessionTrace.vue`) selects `pane_id`; a sssf skill re-install drops it and runs stop attaching to
  panes silently. `bun test bridge/sssf-viz.test.ts` with `SSSF_VIZ_DIR` + `SSSF_TEST_REPO` set is
  the drift tripwire (both now under `Projects\tools\`).
- **Stacked PRs: retarget to `main` before merging the base PR**, then merge, then delete branches —
  deleting a branch another PR targets auto-closes that PR (#15 died that way).
- Don't edit `adws/adw_sssf_config/sssf.config.yaml` while an ADW run is going.
- Never `taskkill /IM bun.exe` — it takes the live bridge and every agy run with it.
