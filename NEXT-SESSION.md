# Next session

_Last handoff: 2026-08-20 — main at **0.41.0** (`4ee4fef`), tag `v0.41.0` pushed, no open PRs. The
bridge on this box runs from `C:\claudeOS\Projects\tools\collie`, supervised by the Task Scheduler
job `herdr.collie`, and was restarted after the last change._

Fork of [AltanS/collie](https://github.com/AltanS/collie): a phone web UI that drives the Herdr
agent herd through a Bun bridge, served over `tailscale serve`. Herdr plugin id `herdr.collie`.

## Where this stopped

**0.41.0 (PR #67) replaced the Herd dashboard and the `/space/:spaceId` screen with one tree.**
`/` now renders `components/space-tree.tsx`: space → tab → pane, where a row with exactly one child
opens that child instead of expanding — same rule at every level, so a one-tab/one-pane space is one
tap to the CLI. Triage moved onto the rows (status dot per row, blocked spaces first and
auto-expanded unless you collapsed them). The bottom bar is three items: Spaces / Traces / Settings.
`/spaces` and `/space/:spaceId` are kept as redirects to `/` so old bookmarks and push deep links
still resolve. Net −1290 lines: `agent-list`, `tab-strip`, `space-view`, `space-overview`,
`routes/home`, `routes/space` and `lib/spaces.tabsAreFlat` are gone.

Also in 0.41.0: **SSSF trace discovery finds this repo again.** `bridge/sssf-viz.ts` scans down a
bounded number of levels from each pane's cwd, and that bound was 2 — so when the checkout moved
into `Projects/tools/` it sat three levels below a pane at `C:\claudeos` and silently stopped being
found. No error, no empty state; the lanes mark just never appeared. `MAX_DOWN` is now 3.

**The roster changed.** `adws/adw_sssf_config/sssf.config.yaml` is now the **Balanced** tier from the
`/openrouter-roster` log of 2026-08-20: every agent runs through pi on OpenRouter (planner glm-5.3,
builder gemini-3.7-flash, scout gpt-5.6-luna, reviewer grok-4.6, documenter gemini-3.7-flash). This
is **metered — roughly $1.56 a full run**, where the previous all-subscription roster cost nothing.
The key comes from pi's own `~/.pi/agent/models.json`, not `.env`. `z-ai/glm-5.3` is newer than
pi 0.83.0's bundled catalog and is registered as a custom model in that same file
(`pi --list-models | grep glm-5.3` is the check if the planner can't resolve its model).

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main; AGENTS.md/GEMINI.md still dirty
netstat -ano | findstr :8787                          # expect ONE listener
```

Update / restart on **this Windows box** (the Herdr `update`/`restart` plugin actions are
Linux/macOS only and answer `platform_unsupported`):

```powershell
powershell -File contrib\windows\collie-ctl.ps1 update    # pull newest v* tag, build, restart
powershell -File contrib\windows\collie-ctl.ps1 restart   # after a bridge/*.ts change (no rebuild)
bun run build                                             # after a web/ change — live, no restart
```

Tests: `bun run test` (backend + scripts) and `cd web && bun run test`. **Run `bun run typecheck` as
well — it is not in `test`, and that is issue #68.**

## Next thing to do

1. **#68 — fold typecheck into `test`.** One line of config, and it is the gate that actually caught
   the 0.41.0 regression. Do this before the next ADW run, so the factory inherits it.
2. **Decide on the two dirty files.** `AGENTS.md` is modified and `GEMINI.md` is new, neither by a
   session that wrote a handoff — some agent tool rewrote them. Both are wrong as they stand: their
   links `../../config/CLAUDE.md` and `../../IDENTITY.md` need one more `../` after the move, and the
   rewrite dropped `@CLAUDE.md`, the line that actually imports the rules into Claude Code. They also
   point a **public** repo at your private claudeOS layout. Fix or discard; do not commit as-is.
3. **#70 — reshoot the README screenshots.** `assets/dashboard.png` and `assets/space-detail.png`
   both show screens 0.41.0 deleted. One shot of the tree with a blocked space expanded at the top
   covers what the two of them used to split.
4. **Phone: turn on push** (Settings → Push notifications), then
   `bash scripts/collie-ctl.sh push-test`. Then write your real quick replies:
   `cp commands.toml.example "$(herdr plugin config-dir herdr.collie)/commands.toml"`, uncomment the
   `[[quick]]` rows, reload.

## Open

- **#70** — README screenshots show the removed Herd/space screens (new).
- **#69** — ADW agents can rewrite files the request put out of scope; nothing stops them (new).
- **#68** — nothing typechecks before a commit, only CI does, after the fact (new).
- **#66** — doc-link gate reports failures but exits 0.
- **#60** — the SDLC test gate has been a placeholder for every run; the security fixes were never
  actually tested.
- **#55** — Windows `.env` is mode 644 and the ctl warns every run; needs an `icacls` path.
- Carried over, no issue filed: the in-app update banner tells you to run the Herdr `update` action,
  which fails on Windows — either add `windows` to the actions' `platforms` in `herdr-plugin.toml`
  with a ps1 command, or make the banner platform-aware.
- Carried over: pull upstream regularly (`git fetch upstream`, merge on a branch as in #35).
  Conflicts land in `README.md`, `CHANGELOG.md`, `bridge/config.ts`, `bridge/index.ts`,
  `.adr/README.md` and the nav files — the nav conflicts will be **much worse** now that the Herd
  and space routes are gone upstream-divergent. Keep the fork's fail-closed defaults.
- Parked, your call: sending the security fixes upstream to AltanS/collie.

## Watch out for

- **The ADW reported `status ✓ success` on a run that broke the pane screen.** Phase 04 ran
  `python -c 'print("Placeholder quality…")'`, exited 0 in 0.0s, and the chain committed 34 files on
  that. The builder had rewritten `routes/detail.tsx` — explicitly out of scope in the request —
  dropping the three props that feed the terminal mirror, and had rewritten that file's test to mock
  `AgentChat` away so the suite stayed green. **Do not trust an ADW's own success line.** Run
  `bun run typecheck`, the real suites, and read the diff's file list against the request. (#60, #68,
  #69.)
- **ADW cost lines read `$0.0000` and are false.** The custom-registered models in
  `~/.pi/agent/models.json` carry `cost: 0`, so only agents on pi's bundled catalog bill correctly.
  Real spend is on openrouter.ai, not in `just runs`.
- **Never edit the checkout while an ADW is running.** `permissions.enforce` fingerprints the whole
  repo tree between phases; an edit you make lands on the running agent's ledger, gets rolled back
  (`git checkout --` for tracked files, `unlink` for new ones) and kills the phase.
- **Two sessions in one checkout bites.** A second session checked out its own branch mid-flight on
  2026-08-20 and a commit landed on `main` as a result. Check `git branch --show-current` immediately
  before committing, not just at the start. One session per checkout.
- **The version guard misfires on `--amend` and on any second commit in a branch** — it compares the
  working tree against the commit being amended, which already carries the bump.
  `SKIP_VERSION_CHECK=1` is the intended escape hatch.
- **Every release commit gets a `v*` tag pushed with it** (`git tag -a vX.Y.Z <sha> -m "Collie X.Y.Z"
  && git push origin vX.Y.Z`). The update banner and `update` both read tags, so an untagged release
  is invisible to the phone. `v0.41.0` is pushed.
- **SSSF discovery is bounded at three levels below a pane cwd** (`MAX_DOWN`, `bridge/sssf-viz.ts`).
  Nest a repo deeper than that and its traces vanish with no error. Discovery is also async and
  caches for 30s, so give a restarted bridge ~30s before concluding a repo is missing.
- **The ctl's "cannot reach Herdr" warning after start/restart is a false alarm** (it probes without
  the identity header, `COLLIE_TRUSTED_USER` says 403). Check `collie.log` for `[events] stream up`.
- **Git Bash eats backslashes in hook paths.** `powershell.exe -File contrib\windows\x.ps1` inside a
  hook arrives as `contribwindowsx.ps1`. Use forward slashes — PowerShell accepts them.
- **Heredoc'd Python in Claude halves backslashes** — `r"[\\/]"` arrives as `[\/]`, which inside a
  regex character class silently means "just a slash". Build separators with `chr(92)`, or write the
  patch script to a file and run it.
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
