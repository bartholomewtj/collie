# Next session

_Last handoff: 2026-08-20 — main at **0.42.0**, tags `v0.41.1` / `v0.41.2` / `v0.42.0` pushed, no
open PRs. The bridge on this box runs from `C:\claudeOS\Projects\tools\collie`, supervised by the
Task Scheduler job `herdr.collie`, and was restarted after the last change (it touched `bridge/`).
The frontend was rebuilt too._

Fork of [AltanS/collie](https://github.com/AltanS/collie): a phone web UI that drives the Herdr
agent herd through a Bun bridge, served over `tailscale serve`. Herdr plugin id `herdr.collie`.

## Where this stopped

**0.42.0 (PR #73) — the bridge now catches the thing that caused 0.41.1.** Nothing rebuilds
`web/dist` for you: not `git pull`, not a branch switch, not editing `web/src`. Only `bun run build`
(or the ctl's `update`, which calls it) does. So a checkout could sit on a correct `main` while the
phone served a bundle built from something else, with **no error anywhere**, because a stale bundle
is a perfectly valid one. `bridge/build-freshness.ts` compares the newest source mtime against
`web/dist/build-info.json` and surfaces the answer three ways: a warning at startup and on every
flip (`[build] web/dist is OLDER than web/ sources (newest: web/src/…)`), `staleBuild` on
`/api/config`, and **"server needs `bun run build`"** in the phone's footer next to the app stamp.
The footer nag is deliberately not a button — the fix is a shell command on the host, so it names
the command instead of offering a control that can't run it.

It is an **mtime comparison, not a content hash**, which means a branch switch that rewrites
timestamps without changing content will also ask for a rebuild. That is the intended trade: the
answer costs seconds, and being wrong the other way cost an hour. Cached 30s (like the SSSF scan),
skips `node_modules` / `dist` / dot-dirs, never follows symlinks, and answers "not stale" when there
is nothing to compare — no build at all (the static handler already 503s with a hint) or no readable
sources (a dist-only deployment).

**0.41.1 (PR #71) — the phone was crashing on every pane, and the source was innocent.** Tapping a
space or a tab gave "Something went wrong / Cannot read properties of undefined (reading 'length')".
The cause was a **stale `web/dist`**: it held a build from `357832a`, the first commit of the
spaces-tree work, whose `routes/detail.tsx` does not pass `AgentChat` its required `text` prop. The
fix for that (`b42a1b5`) landed six minutes later and `bun run build` was never re-run, so for an
hour the phone served a broken bundle while `main` was correct. `undefined` reached
`parseAnsi(display)` and threw at `input.length`. Rebuilding fixed it. Two guards went in with it:
`parseAnsi` now returns `[]` for a non-string input, so a missing mirror reads as an empty pane
rather than a full-screen error boundary, and **`bun run test` typechecks first on both sides**
(#68) — the pre-push hook already did, but `bun run test` did not, which is how the ADW quality gate
reported green on the tree that shipped this.

**0.41.2 — `AGENTS.md` and `GEMINI.md` are gone.** They were the two dirty files the last handoff
left undecided: some agent tool had overwritten `AGENTS.md` with a generic template and created
`GEMINI.md` with the same body, both linking `../../config/CLAUDE.md` and `../../IDENTITY.md` —
paths that point a **public** repo at the private claudeOS layout, and that broke on the move into
`Projects/tools/` anyway. Deleted rather than fixed. `CLAUDE.md` is the only working agreement.
`AGENTS.md` was dropped from the entry-doc list in `scripts/check-doc-links.sh` and from the
staged-docs pattern in `scripts/git-hooks/pre-commit`.

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
git branch --show-current && git status --short      # expect main, clean
netstat -ano | findstr :8787                          # expect ONE listener
cat web/dist/build-info.json                          # the bundle actually being served
```

Update / restart on **this Windows box** (the Herdr `update`/`restart` plugin actions are
Linux/macOS only and answer `platform_unsupported`):

```powershell
powershell -File contrib\windows\collie-ctl.ps1 update    # pull newest v* tag, build, restart
powershell -File contrib\windows\collie-ctl.ps1 restart   # after a bridge/*.ts change (no rebuild)
bun run build                                             # after a web/ change — live, no restart
```

Tests: `bun run test` (backend + scripts) and `cd web && bun run test`. Both typecheck first as of
0.41.1, so there is no longer a separate `bun run typecheck` step to remember.

## Next thing to do

1. **#70 — reshoot the README screenshots.** `assets/dashboard.png` and `assets/space-detail.png`
   both show screens 0.41.0 deleted. One shot of the tree with a blocked space expanded at the top
   covers what the two of them used to split.
2. **Phone: turn on push** (Settings → Push notifications), then
   `bash scripts/collie-ctl.sh push-test`. Then write your real quick replies:
   `cp commands.toml.example "$(herdr plugin config-dir herdr.collie)/commands.toml"`, uncomment the
   `[[quick]]` rows, reload.

## Open

- **#70** — README screenshots show the removed Herd/space screens (new).
- **#69** — ADW agents can rewrite files the request put out of scope; nothing stops them (new).
- **#68** — the gate itself landed in 0.41.1 (`bun run test` typechecks first, both sides). Left
  open for the rest of the issue: a sweep for other gates that report green while checking less than
  they appear to (#60, #66 and this one make three in a row).
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
- **The source being right tells you nothing about what the phone runs.** The bridge serves
  `web/dist` from disk, and its build stamp is `web/dist/build-info.json`. When a UI bug won't
  reproduce in the source, check what is actually deployed *before* reading more code:
  `curl -H "Tailscale-User-Login: $COLLIE_TRUSTED_USER" http://127.0.0.1:8787/api/config` — the
  `build` field names the commit being served. This cost an hour on 2026-08-20. Since 0.42.0 the
  same response carries `staleBuild`, the bridge logs it, and the phone footer says so — but the
  guard only fires once the bridge has *noticed*, and it caches for 30s, so on a fresh rebuild give
  it half a minute before trusting a quiet footer.
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
  is invisible to the phone. `v0.41.0`, `v0.41.1`, `v0.41.2` and `v0.42.0` are pushed.
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
- **If `AGENTS.md` or `GEMINI.md` reappear, an agent tool wrote them, not you.** They were deleted in
  0.41.2 on purpose. Delete again rather than fixing — `CLAUDE.md` is the single working agreement,
  and the template those tools write links a public repo at the private claudeOS layout.
