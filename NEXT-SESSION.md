# Next session

_Last handoff: 2026-08-18 (late) — main at 0.34.0 (`0edfb01`), tag `v0.34.0` pushed, **live on this box**_

## Where this stopped

Fork of [AltanS/collie](https://github.com/AltanS/collie) (phone web UI that drives terminal AI
agents through a Herdr socket, served via `tailscale serve`).

- **SSSF traces tab shipped (PR #38, 0.33.0).** Set `SSSF_VIZ_DIR` and any workspace whose repo has
  `adws/adw_data/sssf.db` gets a Collie-only "Traces" tab showing the SSSF visualiser for that repo,
  in a sandboxed iframe. Everything lives in `bridge/sssf-viz.ts` + `web/src/components/sssf-frame.tsx`
  with one-line hooks; plan `specs/5f2a9c11_sssf-viz-mount.md` (post-council, all six findings folded
  in), decision `.adr/0024`. **It's live on this box**: `SSSF_VIZ_DIR` is in Collie's real `.env`
  (`%APPDATA%\herdr\plugins\config\herdr.collie\.env`) and the log showed the build + `/sssf/` 200.
  The visualiser's own phone/embed edits are in the sssf skill folder
  (`C:\claudeOS\config\skills\sssfppsisualizer`), NOT in any repo — a skill re-install would
  drop them and Collie would log `[sssf] disabled: … lacks BASE_URL` (by design).
- **The real-workflow gap is fixed — PR #39 merged as 0.34.0, rebuilt and restarted here.** Discovery now scans ≤2
  levels DOWN from a pane cwd as well as up; a pane at `C:\claudeOS` finds all 8 SSSF repos under
  `Projects\` (8 ms). The workspace attaches to the repo with the newest run (running first), the
  frame opens on that run's lanes, and a repo-chip row above the frame switches repos. `?repo=<name>`
  is a bridge-assigned name, Map lookup only. Spec `specs/7c31e2a4` marked built. Tests: 15/15 bridge
  (integration half on), new `web/src/components/sssf-frame.test.tsx`. Verified live after the
  restart: `/api/snapshot` stamps the `C:\claudeOS` workspace with all 8 repos, attached to
  `articlegenerator` (its newest finished run).
- **Not yet done — phone-check**: Traces chip in a workspace parked at `C:\claudeOS` → repo row (8 chips — if that's
  too many, consider hiding repos with no run in the last N days) → lanes of the latest run → tap a
  phase block (if the panel doesn't open, swap the block's `navigate()` for an `<a href>` in the
  visualiser's `SessionTrace.vue`).
- **Then test the live-run path with a small real ADW.** Nothing so far has exercised "attach to a
  *running* run + open on its lanes" against a real tracer — only fixtures. Kick off a cheap
  read-only run in this repo (`just demo` — the `adw_scout` half is the longer of the two — or
  `just scout "list the top-level directories. change nothing."`), then on the phone open a
  workspace parked at `C:\claudeOS` and check: (a) the `collie` chip carries the running dot within
  ~30 s (discovery recheck), (b) opening Traces lands straight on that run's lanes, not the list,
  (c) the lanes keep updating while it runs (2 s poll in embed mode), (d) when it finishes the chip
  loses its dot and a fresh open (tap the active Traces chip → list) shows it as `success`. If (a)
  never happens, note the ADW's `adw_id` from the pane and compare with `sessions(1)` — that is the
  pane-text-scraping refinement the spec parked. Don't edit `sssf.config.yaml` mid-run.

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

1. **Phone-check the 0.34.0 Traces tab, then the small live ADW test** (see above). Optional polish the
   council flagged and I skipped: `.zone-head` overlaps ticks only when the request zone is narrow
   (hidden under 640px now); `ctx-detail` numbers only show under `(hover: none)`.
2. **Pull upstream regularly** — `git fetch upstream`, then merge on a branch as in #35. Conflicts
   concentrate in `README.md`, `CHANGELOG.md`, `bridge/config.ts`, `.adr/README.md`. Keep the fork's
   fail-closed defaults; take upstream's docs structure. The SSSF hooks are one-liners in
   `server.ts` (fetch top + snapshot), `types.ts`, `tab-strip.tsx` (`trailing` prop), `space.tsx`,
   `sw-routes.ts` — expect them to conflict trivially.
3. Decide whether to send any of the security fixes upstream to AltanS/collie (parked, your call).

## Open

- No open issues.
- claudeSSSF issue #52 — agy builder hangs on its `schedule` tool and self-commits; fix belongs in
  the factory, not here.

## Watch out for

- **Restarting Collie on Windows:** the Herdr `restart` action says `platform_unsupported`; use
  `powershell -File contrib\windows\collie-ctl.ps1 build` (the restart alone won't rebuild an
  existing `web/dist`) then `… restart`. Its "cannot reach Herdr" warning afterwards is a false
  alarm: the ctl probes `/api/snapshot` without the identity header and gets the 403 from
  `COLLIE_TRUSTED_USER`. Check for real with
  `curl -H "Tailscale-User-Login: <trusted user>" http://127.0.0.1:8787/api/snapshot`. `taskkill /IM bun.exe` kills the live
  bridge too (I did this once by accident on 2026-08-18; Herdr restarted it).
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
