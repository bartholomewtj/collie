# Next session

_Last handoff: 2026-08-20 — main at **0.40.5** (`2bb1933`), tag `v0.40.5` pushed, no open PRs. The bridge on this box is running the 0.40.5 Windows ctl (hidden Task Scheduler job). 0.40.5 changed only `contrib/windows/` — no web rebuild needed._

Fork of [AltanS/collie](https://github.com/AltanS/collie): a phone web UI that drives the Herdr
agent herd through a Bun bridge, served over `tailscale serve`. Herdr plugin id `herdr.collie`.

## Where this stopped

Everything below is merged to `main`, tagged, and running:

- **0.40.0** (PR #52) — `[[quick]]` rows in `commands.toml` replace the Quick dock; Traces list
  shows each repo's last run newest first; restart nudge is one line linking to Settings; "app vX"
  footer vs "Bridge running vY" card; Herd rows stop repeating the tab; Keys pad modifiers row
  above the key grid.
- **0.40.1** (PR #53) — space view hides the tab chips (All / per-tab) when every tab holds one
  pane; only "+ New tab" stays. Section headings keep the name, status, long-press and traces mark.
- **0.40.2** (PR #54, closes #41) — Windows bridge stacking fixed: bash `start|stop|restart` on Git
  Bash delegate to `contrib/windows/collie-ctl.ps1`, which stops every bridge from this checkout,
  waits for :8787 to free, and refuses to start beside a foreign listener. `scripts/*.sh` pinned to
  LF in `.gitattributes` after CI died on a CRLF test file.
- **0.40.3** (PR #57) — the in-app update check now polls **this fork's** tags
  (`bartholomewtj/collie`, the same repo `update` pulls from) instead of upstream's;
  `COLLIE_UPDATE_REPO` overrides and is documented in `.env.example`. README install/clone commands
  name the fork.
- **PR #56** — earlier handoff doc + a `CONTEXT.md` nav row for operator rows (`[[commands]]` / `[[quick]]`).
- **0.40.4** (PR #59) — `CONTEXT.md` rewritten as a complete map (every bridge module, `/api` route →
  handler, web route → file, relative links); `CLAUDE.md` stale rules fixed (Type toggle, subscribe
  is write-level, journal harness list); ADR 0020 superseded by 0021; new
  `scripts/check-doc-links.sh` runs from pre-commit when an entry doc is staged.
- **0.40.5** (PR #61) — Windows Task Scheduler job starts through `wscript.exe` + generated
  `exec-bridge.vbs`, so the bridge has no console window and no taskbar button. `start` skips this
  process and its ancestors (and compares process ids as `int` — `Win32_Process.ProcessId` is
  `UInt32`) so it does not kill the wscript host as it comes up.
- **Push notifications are on** bridge-side (VAPID keys in the plugin `.env`; `/api/config` says
  `push: true`). Not yet confirmed enabled on the phone (Settings → Push notifications).
- **Git hooks are installed** in this checkout (pre-push runs typecheck + `bun test`). Windows fails
  ~34 bridge tests (symlinks/chmod/sockets); push with `SKIP_TESTS=1`. GitHub CI is the real bar.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main, clean
netstat -ano | findstr :8787                          # expect ONE listener
```

Update / restart on **this Windows box** (the Herdr `update`/`restart` plugin actions are
Linux/macOS only and answer `platform_unsupported`):

```powershell
powershell -File contrib\windows\collie-ctl.ps1 update    # pull newest v* tag, build, restart
powershell -File contrib\windows\collie-ctl.ps1 restart   # after a bridge/*.ts change (no rebuild)
bun run build                                             # after a web/ change — live, no restart
```

Clean test bar without WSL:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "C:\claudeOS\Projects\tools\collie:/src:ro" oven/bun:1 bash -c \
  'cp -r /src /w && cd /w && apt-get update -qq >/dev/null && apt-get install -y -qq git >/dev/null 2>&1; rm -rf node_modules web/node_modules && bun install --frozen-lockfile >/dev/null; bun test bridge | tail -3; bash scripts/collie-ctl.test.sh 2>&1 | tail -1'
```

## Next thing to do

1. **Phone: turn on push** (Settings → Push notifications), then `bash scripts/collie-ctl.sh push-test`.
   Then write your real quick replies: `cp commands.toml.example "$(herdr plugin config-dir herdr.collie)/commands.toml"`,
   uncomment the `[[quick]]` rows, reload the page.
2. **Phone-check 0.40.x on a working day** — flat-space view (chips gone, "+ New tab" present; chips
   come back on a space where a tab has 2+ panes), Traces list wording, Keys pad order, restart line,
   update banner (should now name a `bartholomewtj/collie` release). Fix-ups are patch bumps.
3. **Update banner text on Windows** — it tells you to run the Herdr `update` action, which fails
   here. Either add `windows` to the actions' `platforms` in `herdr-plugin.toml` with a ps1 command
   (`contrib/windows/README.md` describes the edit) or make the banner platform-aware. Small.
4. **Issue #55** — `.env` is mode 644 on Windows and the ctl warns every run; needs an `icacls` path.
5. **Pull upstream regularly** — `git fetch upstream`, merge on a branch as in #35. Conflicts land in
   `README.md`, `CHANGELOG.md`, `bridge/config.ts`, `bridge/index.ts` (update-repo default),
   `.adr/README.md`, and the nav/space files (`root.tsx`, `home.tsx`, `space.tsx`, `space-view.tsx`,
   `space-overview.tsx`, `tab-strip.tsx`, `agent-chat.tsx`, `app-header.tsx`, `traces.tsx`). Keep
   the fork's fail-closed defaults and fork repo default; take upstream's docs structure.

## Open

- Issue #55 — Windows `.env` perms warning (above).
- claudeSSSF #57 — `verdict_consistent` gate rejects Bun/TS evidence; restamp `adws/` here after.
- claudeSSSF #52 — agy builder hangs on its `schedule` tool; factory-side.
- Parked, your call: sending the security fixes upstream to AltanS/collie.

## Watch out for

- **Two sessions in one checkout bites.** On 2026-08-19 two sessions worked this repo at once; one
  committed under the other's uncommitted edits, and a CRLF test file slipped into a PR. Check
  `git branch --show-current` and `git status` before editing; one session per checkout.
- **Windows checkout is CRLF** (`core.autocrlf=true`) except `scripts/*.sh`, pinned LF. If you add a
  shell script elsewhere, add it to `.gitattributes` too, or CI's bash dies on `set: pipefail\r`.
  `sed -n` hides the `\r`; `git cat-file -p HEAD:file | od -c | grep -c '\\r'` shows it. Heredoc'd
  Python in Claude halves backslashes — write patch scripts to a file and run them.
- **The ctl's "cannot reach Herdr" warning after start/restart is a false alarm** (it probes without
  the identity header, `COLLIE_TRUSTED_USER` says 403). Check `collie.log` for `[events] stream up`,
  or `curl -H "Tailscale-User-Login: <you>" http://127.0.0.1:8787/api/config`.
- **Skill-folder edits are not in this repo** — the SSSF visualiser (`db.ts`, `shared/types.ts`,
  `SessionTrace.vue`) selects `pane_id`; a sssf skill re-install drops it and runs stop attaching to
  panes silently. `bun test bridge/sssf-viz.test.ts` with `SSSF_VIZ_DIR` + `SSSF_TEST_REPO` set is the
  drift tripwire.
- **Stacked PRs: retarget to `main` before merging the base PR**, then merge, then delete branches —
  deleting a branch another PR targets auto-closes that PR (#15 died that way).
- **Every release commit gets a `v*` tag pushed with it** (`git tag -a vX.Y.Z <sha> -m "Collie X.Y.Z"
  && git push origin vX.Y.Z`); the update banner and `update` both read tags, so an untagged release
  is invisible to the phone.
- Don't edit `adws/adw_sssf_config/sssf.config.yaml` while an ADW run is going.
- Never `taskkill /IM bun.exe` — it takes the live bridge and every agy run with it.
