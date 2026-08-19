# Next session

_Last handoff: 2026-08-19 — main at **0.40.1** (`6ed77d8`, tag `v0.40.1` not yet pushed); PR #54 = 0.40.2 open_

Fork of [AltanS/collie](https://github.com/AltanS/collie): a phone web UI that drives the Herdr
agent herd through a Bun bridge, served over `tailscale serve`. Herdr plugin id `herdr.collie`.

## Where this stopped

- **0.40.0 shipped and phone-checked** (PR #52): `[[quick]]` rows in `commands.toml` replace the
  Quick dock; Traces list shows each repo's last run ("success · 2h ago") newest first; restart nudge
  is one line linking to Settings (the host command lives on Settings only); "app vX" footer vs
  "Bridge running vY" card; Herd rows stop repeating the tab as line 2; Keys pad modifiers row
  moved above the key grid.
- **0.40.1 merged** (PR #53, from a second session): tab chips hidden in a space when every tab
  holds one pane. Its `v0.40.1` tag was **not** pushed — do that (below).
- **PR #54 (0.40.2) open — closes #41.** Windows bridge stacking had two causes: `start_unsupervised`
  in `scripts/collie-ctl.sh` launched the bridge TWICE (a merge kept both `nohup` lines, c39b3b2),
  and the ps1 `stop` only knew its one recorded pid pair. Now: bash `start|stop|restart` on Git Bash
  delegate to `contrib/windows/collie-ctl.ps1`; the ps1 stops every bridge from this checkout, waits
  for the port to free, and refuses to start beside a foreign listener. Reproduced + verified live.
  The second session then pinned `scripts/*.sh` to LF in `.gitattributes` (657f555) after CI died on
  a CRLF test file.
- **Push notifications are on**: VAPID keys generated into the plugin `.env` (`bun scripts/push-keys.ts
  <cfg>/.env mailto:…` — note `bun scripts/…`, not `bun run`); `/api/config` says `push: true`.
  Not yet enabled on the phone (Settings → Push notifications).
- Bridge on this box: pid 5160, one listener, started from the 0.40.1 tree with #54's scripts.
  `web/dist` is a 0.40.x build — rebuild after merging #54 so the stamp is clean.

## Resume with

```bash
cd C:\claudeOS\Projects\collie
git checkout main && git pull
git tag -a v0.40.1 6ed77d8 -m "Collie 0.40.1" && git push origin v0.40.1     # missed at merge time
bun run build && bash scripts/collie-ctl.sh restart && netstat -ano | findstr :8787   # expect ONE listener
```

Clean test bar without WSL (Windows fails 34 bridge tests on symlinks/chmod/sockets — same set on
every branch; the ctl bash tests only pass on Linux):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "C:\claudeOS\Projects\collie:/src:ro" oven/bun:1 bash -c \
  'cp -r /src /w && cd /w && apt-get update -qq >/dev/null && apt-get install -y -qq git >/dev/null 2>&1; rm -rf node_modules web/node_modules && bun install --frozen-lockfile >/dev/null; bun test bridge | tail -3; bash scripts/collie-ctl.test.sh 2>&1 | tail -1'
```

## Next thing to do

1. **Merge #54**, tag `v0.40.2` on its release commit (`1578357`), rebuild + restart (command above),
   confirm one listener. #41 closes on merge.
2. **Phone: turn on push** (Settings → Push notifications), then `bash scripts/collie-ctl.sh push-test`.
   Then write your real quick replies: `cp commands.toml.example "$(herdr plugin config-dir herdr.collie)/commands.toml"`,
   uncomment the `[[quick]]` rows, reload the page.
3. Phone-check the 0.40.x screens once more on a working day (Traces list wording, Keys pad order,
   restart line) — fix-ups are patch bumps.
4. **Pull upstream regularly** — `git fetch upstream`, merge on a branch as in #35. Conflicts land in
   `README.md`, `CHANGELOG.md`, `bridge/config.ts`, `.adr/README.md`, and now the nav/space files
   (`root.tsx`, `home.tsx`, `space.tsx`, `space-view.tsx`, `space-overview.tsx`, `agent-chat.tsx`,
   `app-header.tsx`, `traces.tsx`). Keep the fork's fail-closed defaults; take upstream's docs structure.

## Open

- PR #54 — Windows bridge stacking (0.40.2). Waiting on your merge; closes #41.
- Issue #55 — `.env` is mode 644 on Windows and the ctl warns every run; needs an `icacls` path.
- claudeSSSF #57 — `verdict_consistent` gate rejects Bun/TS evidence; restamp `adws/` here after.
- claudeSSSF #52 — agy builder hangs on its `schedule` tool; factory-side.
- Parked, your call: sending the security fixes upstream to AltanS/collie.

## Watch out for

- **Two sessions in one checkout bites.** On 2026-08-19 a second session switched branches and
  committed under this one's uncommitted edits, twice. Check `git branch --show-current` and
  `git status` before editing, and don't run two Claude sessions against this repo at once.
- **Restart on Windows:** `bash scripts/collie-ctl.sh restart` (delegates to the ps1). The Herdr
  `restart` action says `platform_unsupported`. `restart` alone doesn't rebuild `web/dist` — run
  `bun run build` first for frontend changes (live, no restart); bridge/*.ts changes need the restart.
  The ctl's "cannot reach Herdr" warning afterwards is a false alarm (it probes without the identity
  header, `COLLIE_TRUSTED_USER` says 403); check with
  `curl -H "Tailscale-User-Login: <you>" http://127.0.0.1:8787/api/config`.
- **Skill-folder edits are not in this repo** — the SSSF visualiser (`db.ts`, `shared/types.ts`,
  `SessionTrace.vue`) selects `pane_id`; a sssf skill re-install drops it and runs stop attaching to
  panes silently. `bun test bridge/sssf-viz.test.ts` with `SSSF_VIZ_DIR` + `SSSF_TEST_REPO` set is the
  drift tripwire.
- **Stacked PRs: retarget to `main` before merging the base PR**, then merge, then delete branches —
  deleting a branch another PR targets auto-closes that PR (#15 died that way).
- The Windows checkout is CRLF (except `scripts/*.sh`, now pinned LF). Heredoc'd Python in Claude
  halves backslashes — write patch scripts to a file and run them; `sed -n` hides the `\r`.
- Don't edit `adws/adw_sssf_config/sssf.config.yaml` while an ADW run is going.
- Never `taskkill /IM bun.exe` — it takes the live bridge and every agy run with it.
