# Next session

_Last handoff: 2026-08-18 (late) — main at **0.38.0** (`d8715f9`), tag `v0.38.0`, **live on this box**, not phone-checked_

## Where this stopped

- **0.38.0 shipped — PR #49 merged, tagged, `web/dist` rebuilt here (frontend-only, no bridge restart;
  serves `0.38.0+d8715f9`).** Run `9131ebc6`: **hold a pane row in a space's list** (agent or shell) →
  the existing `PaneActionsSheet` (rename / close). `AgentCard.onLongPress` is optional — the home
  herd list passes nothing and renders as before; `SpaceView` owns the sheet, `space.tsx` wires
  `onPaneClosed` → revalidate. Every hold target now shares one hook + three sheets (pane / tab /
  space). Not phone-checked.
- **0.37.0 shipped — PR #47 merged, tagged, bridge restarted here (pid 22504, one listener on :8787,
  serves `0.37.0+1a85eb2`). Three features, each its own `adw_simple_sdlc` run on one stacked branch:**
  1. `4396573c` — **tap-and-hold a tab heading** in a space's "All" list → the same Rename / Close
     sheet as the tab chips (`space-view.tsx` `TabHeading`; props threaded from `routes/space.tsx`).
  2. `8d2c86fe` — **Spaces rows carry the lanes icon** when the space has SSSF repos, green dot while
     `w.sssf.repos.some(running)`, tap → `tracePath(space, attached.repo ?? repos[0])`. The row is now
     a `<div>` holding the row button + a sibling icon button (`space-overview.tsx`).
  3. `31bcbf4a` — **tap-and-hold a Spaces row → rename the space.** New bridge route
     `POST /api/workspace/:id/rename` (write guard, audit `workspace.rename`, `normalizeLabel` shared
     with tabs), `HerdrClient.renameWorkspace`, `space-actions-sheet.tsx` (rename only — no close).
  **None of it phone-checked yet.** Things to look at on the phone: does the tab-heading hold register
  (the target is a small `text-xs` button — widen its padding if it's fiddly); does the row hold fire
  without also opening the space; is the lanes icon crowding a 390px row.
- **Docs current as of this handoff:** CLAUDE.md gained the tap-and-hold rule; ARCHITECTURE §4 and
  CONTEXT.md (version stamp, nav-table row for the long-press sheets) updated. `HERDR_API.md`
  `workspace.rename` is now wired (was listed, unused).
- **Factory findings from tonight's runs, all filed in claudeSSSF:**
  - **#57 (new)** — the `verdict_consistent` gate rejects valid command evidence in Bun/TS repos
    (`_COMMAND` knows no `bun`/`bunx`/`tsc`; `_OUTCOME` no "untouched/clean"), so every review here
    fails once and retries. Fix is regex + tests in `gates.py` (both copies), then restamp this repo's
    `adws/`.
  - **#9 comment** — the "rate limited: sleeping 5s" console line in run 2 was the agy **stall** guard
    (600 s idle → kill → resend), not a limit; suggested labelling it `stalled:`. **#52 comment** — that
    stall recurred; the guard recovered it.
  - When a run's stderr is redirected into `adws/adw_data/`, the ADW's git phase sweeps the file into
    a commit (`obs.log.err` did tonight; removed in b619f5d). Redirect run logs to the scratchpad, or
    add `adws/adw_data/*.log*` to `.gitignore`.

- **Runs attach to the pane that launched them — PR #46 merged as 0.36.0, tagged, live here, NOT yet
  phone-checked.** Chain: Herdr sets `HERDR_PANE_ID` in every pane → the SSSF tracer writes it to
  `sessions.pane_id` (claudeSSSF PR #56 merged; the same one-file patch is on main in
  articlegenerator, geneanalysis, overtimetracker, paperfetch, roster-board, signalchecker and this
  repo's own `adws/`; the Pi sssf skill template too) → visualiser `db.ts` + `shared/types.ts` select
  `pane_id` (skill-folder edit — a skill re-install drops it, and then no run attaches, silently) →
  `bridge/sssf-viz.ts` `decoratePanes` stamps `pane.sssf.runs` → lanes button in the pane header (green
  dot while live) → `/traces/:space/:repo?pane=<id>[&adw=<id>]` with a chip row, ‹ back to the pane.
  **No run has carried a pane yet.** The first ADW launched from a pane is the real end-to-end check:
  the button should appear within ~30 s of the run starting (discovery re-reads every RECHECK_MS).
  If it doesn't: `python -c "import sqlite3;print(sqlite3.connect('adws/adw_data/sssf.db').execute('select adw_id,pane_id from sessions order by started_at desc limit 3').fetchall())"`
  in the repo tells you whether the tracer wrote it; `/api/snapshot` (with the identity header)
  tells you whether the bridge stamped it. Runs from a scheduler / plain terminal never attach — by
  design. Judgment call open: whether the run chips should hide finished runs older than N days.

Fork of [AltanS/collie](https://github.com/AltanS/collie) (phone web UI that drives terminal AI
agents through a Herdr socket, served via `tailscale serve`).

- **Nav rebuilt on phone-app lines — PR #43 merged as 0.35.0, tagged.** Bottom tab bar Herd / Spaces / Traces / Settings (`web/src/components/bottom-nav.tsx`,
  mounted in `routes/root.tsx`, shown on `/`, `/spaces`, `/space/*`, `/traces`, `/settings`); every
  pushed screen gets `AppHeader onBack` (a "‹" that goes up one level: pane → space → Spaces, trace →
  Traces, history → pane). New routes `routes/spaces.tsx`, `routes/traces.tsx` (`/traces` list,
  `/traces/:spaceId/:repo` full-screen frame). Removed: `SpaceStrip`, `SssfChip`, `SssfRepoRow`,
  `TabStrip.trailing`, `spaceTracesPath`/`?tab=traces&from=`, the Settings gear, the in-pane tab
  strip, the space heading in `SpaceView`. Typecheck clean, 2617 web tests pass, clicked through on
  the tailnet URL. The bridge here serves this build (`web/dist` rebuilt from it before merge; the
  merged tree is identical). Not yet phone-checked by Bart. Judgment call to confirm: the in-pane
  tab strip is gone (swipe-up switcher and back → space cover it); offer a compact one back if
  missed. `CLAUDE.md` now states the nav rule (bottom bar + one back) so upstream merges don't
  reintroduce a second way back.
- **Visualiser phone fix (in the sssf skill folder, not this repo):** `SessionTrace.vue` ≤640px now
  keeps the waterfall at desktop width (`min-width: 900px`), scrolls it sideways, and pins the
  lane-name column (`position: sticky`). Collie rebuilt it on restart. Same caveat as the other
  skill-folder edits: a skill re-install drops it.
- **Issue #41 bit again today:** three bridges were listening on :8787 (two strays from 8:52 PM,
  one Task Scheduler). Requests round-robin, so the phone got stale CSS 2 in 3 loads. Killed the
  strays by pid; one listener now. Check `netstat -ano | findstr :8787` before trusting a restart.
- **SSSF traces tab shipped (PR #38, 0.33.0).** Set `SSSF_VIZ_DIR` and any workspace whose repo has
  `adws/adw_data/sssf.db` gets a Collie-only "Traces" tab showing the SSSF visualiser for that repo,
  in a sandboxed iframe. Everything lives in `bridge/sssf-viz.ts` + `web/src/components/sssf-frame.tsx`
  with one-line hooks; plan `specs/5f2a9c11_sssf-viz-mount.md` (post-council, all six findings folded
  in), decision `.adr/0024`. **It's live on this box**: `SSSF_VIZ_DIR` is in Collie's real `.env`
  (`%APPDATA%\herdr\plugins\config\herdr.collie\.env`) and the log showed the build + `/sssf/` 200.
  The visualiser's own phone/embed edits are in the sssf skill folder
  (`C:\claudeOS\config\skills\sssf\apps\visualizer`), NOT in any repo — a skill re-install would
  drop them and Collie would log `[sssf] disabled: … lacks BASE_URL` (by design).
- **The real-workflow gap is fixed — PR #39 merged as 0.34.0, rebuilt and restarted here.** Discovery now scans ≤2
  levels DOWN from a pane cwd as well as up; a pane at `C:\claudeOS` finds all 8 SSSF repos under
  `Projects\` (8 ms). The workspace attaches to the repo with the newest run (running first), the
  frame opens on that run's lanes, and a repo-chip row above the frame switches repos. `?repo=<name>`
  is a bridge-assigned name, Map lookup only. Spec `specs/7c31e2a4` marked built. Tests: 15/15 bridge
  (integration half on), new `web/src/components/sssf-frame.test.tsx`. Verified live after the
  restart: `/api/snapshot` stamps the `C:\claudeOS` workspace with all 8 repos, attached to
  `articlegenerator` (its newest finished run).
- **Phone-checked against a real running ADW (paperfetch slice 7, PR #40 → 0.34.1).** The chip
  carried the running dot, Traces opened on the run's lanes, lanes updated live. Two things it
  found, both fixed and merged: (1) the frame 404'd on the primary session — `server.ts` keyed
  discovery by `rt.name` (`default`) while the frame sends no `session` param on primary; now
  keyed on the request's `sessionName`. (2) No way to reach Traces from the pane (terminal) view —
  `AgentChat` got a `tabTrailing` slot, `detail.tsx` puts the `SssfChip` there, tapping goes to
  `spaceTracesPath()` = `/space/<id>?tab=traces&from=<paneId>`, and `space.tsx` shows a
  "← Back to terminal" button for that pane. Not done: the pane-text `adw_id` scrape the spec
  parked; still no need seen.

- **Security audit is done.** All 12 issues filed on 2026-08-16 are fixed and merged (#12 landed as
  PR #27, 0.32.2); each has a spec in `specs/`, a write-up in `app_docs/`, and an ADR where a default
  changed (`.adr/0019`–`0023`).
- **Upstream is merged in** (PR #35): AltanS/collie 0.30.0 → 0.31.1 landed as fork **0.32.0**.
  Both repos had used `0.31.1` for different content, so the fork's version line now runs ahead;
  `CHANGELOG.md` keeps upstream's entries under their own heading.
- **ADRs renumbered** (PR #36): the fork's five ADRs moved from 0011–0014 to 0019–0023 so
  upstream's reserved `v1` block (0011–0016) can't collide.
- Nothing has been reported upstream.

## Resume with

```bash
cd C:\claudeOS\Projects\collie
git checkout main && git pull
git fetch upstream && git log --oneline HEAD..upstream/main    # anything new upstream?
bun install --frozen-lockfile && bun test ./bridge/server.test.ts
```

Clean test bar without WSL — run in a container (mount path must be Windows-style):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "C:\claudeOS\Projects\collie:/src:ro" oven/bun:1 bash -c \
  'cp -r /src /w && cd /w && rm -rf node_modules web/node_modules && bun install --frozen-lockfile >/dev/null; bun test bridge | tail -3'
```

For `scripts/collie-ctl.test.sh` in that container also `apt-get install -y git` and strip CRLF
first: `find scripts -name "*.sh" -exec sed -i "s/\r$//" {} +`.

## Next thing to do

1. **Phone-check 0.37.0 + 0.38.0** (both live): pane-row hold and tab-heading hold in a space's list; Spaces row hold →
   rename; lanes icon + green dot on a space with a running ADW; then the still-unchecked 0.36.0
   pane-header Traces button and 0.35.0 nav. Fix-ups are patch bumps.
2. **Fix claudeSSSF #57**, restamp `adws/` here, and watch the next run's review pass first time.
3. Optional Traces polish the council flagged and I skipped: `.zone-head` overlaps ticks only when the request zone is narrow
   (hidden under 640px now); `ctx-detail` numbers only show under `(hover: none)`.
4. **Pull upstream regularly** — `git fetch upstream`, then merge on a branch as in #35. Conflicts
   concentrate in `README.md`, `CHANGELOG.md`, `bridge/config.ts`, `.adr/README.md`. Keep the fork's
   fail-closed defaults; take upstream's docs structure. The SSSF hooks are one-liners in
   `server.ts` (fetch top + snapshot), `types.ts`, `routes/traces.tsx` — expect them to conflict
   trivially. After #43/#47 the nav and space files (`root.tsx`, `home.tsx`, `space.tsx`,
   `space-view.tsx`, `space-overview.tsx`, `agent-chat.tsx`, `app-header.tsx`) diverge from upstream
   more; expect real conflicts there.
5. Decide whether to send any of the security fixes upstream to AltanS/collie (parked, your call).

## Open

- Issue #41 — Windows: `collie-ctl.sh stop/restart` doesn't kill `bun.exe`, and each `start` binds
  another listener on :8787 next to the old ones (five were answering on 18 Aug). Kill by pid with
  `taskkill //PID <pid> //F` after `netstat -ano | findstr :8787`, then one `start`.
- claudeSSSF issue #52 — agy builder hangs on its `schedule` tool and self-commits; fix belongs in
  the factory, not here.

## Watch out for

- **Restarting Collie on Windows:** the Herdr `restart` action says `platform_unsupported`; use
  `powershell -File contrib\windows\collie-ctl.ps1 build` (the restart alone won't rebuild an
  existing `web/dist`) then `… restart`. Its "cannot reach Herdr" warning afterwards is a false
  alarm: the ctl probes `/api/snapshot` without the identity header and gets the 403 from
  `COLLIE_TRUSTED_USER`. Check for real with
  `curl -H "Tailscale-User-Login: <trusted user>" http://127.0.0.1:8787/api/snapshot`. `taskkill /IM bun.exe` kills the live
  bridge too (I did this once by accident on 2026-08-18; Herdr restarted it). **`bash scripts/collie-ctl.sh restart` does not stop the old bridge on Windows** — see issue #41; check `netstat -ano | findstr :8787` shows one pid tree before trusting a restart.
- **`bun test bridge/sssf-viz.test.ts` has an integration half** that runs only with
  `SSSF_VIZ_DIR` and `SSSF_TEST_REPO=C:/ClaudeOS/Projects/claudeSSSF` set — run it after any sssf
  skill update; it imports the real `db.ts` and is the drift tripwire.

- **Stacked PRs: retarget to `main` before merging the base PR**, then merge, then delete branches.
  Deleting a branch another PR targets auto-closes that PR (how #15 died; #18 replaced it).
- **Don't edit `adws/adw_sssf_config/sssf.config.yaml` while a run is going** — the builder's
  permission check sees a changed protected file and rolls it back.
- `bun test ./bridge` fails 34 tests on Windows (symlinks, chmod 0600, unix sockets) — same set on
  every branch. Judge by the tests you touched, or use the container above (752/752 on Linux).
- The Windows checkout is CRLF (autocrlf). Python `str.replace` scripts need `\r\n`; `sed -n` hides
  the `\r`. `bash scripts/*.sh` on Linux fails with `set: pipefail: invalid option` until stripped.
- `sssf.db` shows several old sessions as `running`/`fail` — killed runs whose work was harvested
  by hand. Not live.
- Roster (`sssf.config.yaml`): planner opus, builder/scout/documenter agy, reviewer grok-4.5.
- `gh` default repo is this fork; `origin` = fork, `upstream` = AltanS/collie.
