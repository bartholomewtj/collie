# Plan — reshoot README screenshots for the Spaces tree (issue #70)

## Goal

`assets/dashboard.png` and `assets/space-detail.png` still show the Herd dashboard and the
`/space/:spaceId` screen that 0.41.0 deleted. Replace both with shots of the current **Spaces
tree** (the `/` home), and update the two matching Demo-table captions in `README.md` so they
describe the tree, not the deleted screens.

**Out of scope:** the other screenshots (ask-question.png, keys.png, session-switcher.png,
settings.png, collie-hero.webp), any version bump (doc + assets only — CLAUDE.md's doc-only rule;
no file under `bridge/`, `web/src/`, `scripts/`, `herdr-plugin.toml` may change), editing
`web/src`, and rewriting the rest of the README.

## Facts established during planning (do not re-derive)

- The checkout is **already on branch `docs/issue-70-screenshots`** (verify with
  `git branch --show-current` right before committing — NEXT-SESSION.md warns about sessions
  colliding in one checkout).
- The bridge is **live at `http://127.0.0.1:8787`** and `COLLIE_TRUSTED_USER` is **fail-closed**:
  verified this session that no header → 403, wrong header → 403, real header → 200.
- The trusted login value lives at
  `C:\Users\barth\AppData\Roaming\herdr\plugins\config\herdr.collie\.env` under
  `COLLIE_TRUSTED_USER=` (the scheduled task `herdr.collie` runs `exec-bridge.vbs`, which loads
  it). **Never echo or print the value** — read it into a shell variable at use time.
- Current herd state (checked this session): Grok space = `working`, claudeos and Agy = `done`.
  **No agent is in the "needs" (blocked) bucket right now.** Re-check at capture time — the shot
  the request wants (blocked space auto-expanded at the top) is only real if a "needs" agent
  exists then. Blocked spaces sort first and auto-expand by default
  (`web/src/components/space-tree.tsx` ~107/222); a fresh browser profile has empty localStorage,
  so the defaults apply.
- `/space/:spaceId` is a **kept redirect** that lands on `/` with that space expanded in the tree
  (`web/src/routes/redirects.tsx`, `SpaceRedirect`) — a pure-URL way to get an expanded space in
  a headless shot, no clicking needed.
- Chrome exists at `C:\Program Files\Google\Chrome\Application\chrome.exe` (Edge too). A Playwright
  Chromium cache exists at `~/AppData/Local/ms-playwright/chromium-1234` (fallback only).
- Existing PNGs are ~525×1136 (phone aspect). README renders them at `width="250"`.
- The bridge serves `web/dist` from disk — before shooting, confirm the served build is current
  via `/api/config` (`build` names the commit; `staleBuild` flag). If stale, run `bun run build`
  (root) and give the bridge ~30s before trusting a quiet flag.

## Steps

### 1. Preflight

```bash
git branch --show-current          # expect docs/issue-70-screenshots
TU=$(grep -h "^COLLIE_TRUSTED_USER=" "C:/Users/barth/AppData/Roaming/herdr/plugins/config/herdr.collie/.env" | head -1 | cut -d= -f2-)
curl -s -m 3 -H "Tailscale-User-Login: $TU" -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/api/config   # expect 200
curl -s -m 3 -H "Tailscale-User-Login: $TU" http://127.0.0.1:8787/api/config | grep -o '"staleBuild":[a-z]*'
```

If `staleBuild:true`, run `bun run build` at the repo root and wait ~30s. **Do not restart or
reconfigure the bridge.**

Also pull `/api/snapshot` (same header) and list each workspace's `workspaceId`,
`workspaceLabel` and worst agent `status` — you need this to pick subjects, and to know whether a
"needs"/blocked space exists for the auto-expanded-top frame. If none exists, capture the tree as
it actually is and write captions that match reality; **do not stage or fake a blocked state**.

### 2. Header-injecting proxy (Chrome can't send custom headers)

Chrome headless has no `--header` flag, and the bridge 403s without the identity header. Run a
tiny proxy **outside the repo** (e.g. `$TMP/collie-shot/proxy.ts`), started with the login in an
env var so the value never lands in a repo file:

```bash
mkdir -p "$TMP/collie-shot"
TU=$(grep -h "^COLLIE_TRUSTED_USER=" "C:/Users/barth/AppData/Roaming/herdr/plugins/config/herdr.collie/.env" | head -1 | cut -d= -f2-)
COLLIE_TRUSTED_USER="$TU" bun "$TMP/collie-shot/proxy.ts" &   # keep PID to kill later
```

`proxy.ts` (write it in the temp dir, not the repo): `Bun.serve({ port: 8790, hostname: "127.0.0.1" })`
whose fetch handler builds a `Request` to `http://127.0.0.1:8787` + the incoming path, copying
method/body, **setting** `Tailscale-User-Login: process.env.COLLIE_TRUSTED_USER`, and either
keeping the original Host (`127.0.0.1:8790`, loopback — passes the fail-closed host check) or
rewriting it to `127.0.0.1:8787`; return the forwarded `Response` as-is. Same-origin gate is
satisfied because the page itself is served from `127.0.0.1:8790`.

Sanity-check before shooting: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8790/`
must be 200 (HTML), not 403.

### 3. Capture both shots (phone viewport, fresh profile each time)

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=390,844 --force-device-scale-factor=2 \
  --user-data-dir="$TMP/collie-shot/profile-a" \
  --virtual-time-budget=20000 \
  --screenshot="C:/claudeOS/Projects/tools/collie/assets/dashboard.png" \
  "http://127.0.0.1:8790/"
```

- **Shot A → `assets/dashboard.png`**: plain `/`. In a fresh profile a blocked space (if one
  exists at capture time) sorts first and auto-expands; every row carries its status dot — tree
  and triage-on-rows in one frame. If no blocked space exists, this is simply the tree; that's
  fine, the caption must then say so.
- **Shot B → `assets/space-detail.png`**: pick a space with **≥ 2 tabs** from the snapshot and
  shoot `http://127.0.0.1:8790/space/<workspaceId>` — the redirect expands that space in the tree
  on the way past. Use a second `--user-data-dir` so Shot A's localStorage doesn't interfere.
  If `--virtual-time-budget` yields a blank/partial render in new headless, retry with
  `--timeout=20000` instead.

**Shoot to a temp path first, review with the `read` tool (it renders PNGs), and only then copy
over `assets/*.png`.** Gate each image on: it shows the current Spaces tree (bottom bar, space →
tab rows, status dots) — NOT the old Herd dashboard (Needs you / Recent / Spaces cards) and NOT
the old space-detail screen; and it contains **no pane body text** — only row labels. Never
navigate to `/pane/...` while capturing.

Fallback if Chrome headless won't cooperate: a one-off Playwright script in the temp dir
(`bun add playwright` there, browsers already cached at `~/AppData/Local/ms-playwright`), with
`context = browser.newContext({ viewport: {width:390,height:844}, deviceScaleFactor: 2,
extraHTTPHeaders: { "Tailscale-User-Login": process.env.COLLIE_TRUSTED_USER } })` — then you can
also `page.click()` a space row directly instead of using the redirect URL.

### 4. README.md — Demo table captions only (~lines 66–73)

Update exactly the two cells; leave the other four figures and all surrounding prose untouched:

- `dashboard.png` cell — replace the stale alt/caption
  (`Collie dashboard — Needs you, Recent, Spaces` / `Dashboard — agents needing you float to the
  top`) with text describing what the new image actually shows, e.g.:
  `alt="Collie Spaces tree — spaces, tabs and panes with a status dot on every row"` and
  `<b>Spaces</b> — the whole herd in one tree, who needs you sorted to the top`.
- `space-detail.png` cell — replace `A space's tabs and panes` / `Space — its tabs and panes,
  deep-linkable` with e.g. `alt="A space expanded in the Spaces tree, showing its tabs"` and
  `<b>Space</b> — expanded in place, one tap from tree to CLI`.

Final wording is the builder's call, but captions must describe what is visibly in the new PNGs
(adjust if no blocked space made it into Shot A). Keep the existing `<td align="center"
width="50%">` / `width="250"` / `<sub><b>…</b> — …</sub>` shape.

### 5. Cleanup and verification

- Kill the proxy (`kill <pid>`), delete `$TMP/collie-shot/`.
- `git status --short` must show **exactly** `assets/dashboard.png`, `assets/space-detail.png`,
  `README.md` — nothing else. No version files, no `web/src`, no bridge files.
- No version bump, no CHANGELOG entry (assets + docs only). The pre-commit hook agrees: no
  functional path changed. If it misfires, `SKIP_VERSION_CHECK=1` is the escape hatch — but a
  clean `git status` should make that unnecessary.
- Commit on `docs/issue-70-screenshots`, e.g.
  `git commit -am "Reshoot README screenshots for the Spaces tree (fixes #70)"`.
  Do not push/merge unless that is the operator's instruction for this session; one session per
  checkout, and check the branch again immediately before committing.

### 6. Closing the issue

`gh issue close 70` becomes valid once this lands on `main`. If this session is expected to land
it (merge to `main` + push per the operator's normal flow), close with a one-line comment naming
the two new images; otherwise leave the issue open and say in the report that the branch is ready.

## Done means

- Both PNGs show the current Spaces tree — no Herd dashboard, no deleted space-detail screen, no
  pane body text.
- README's two Demo-table captions describe the tree.
- `git status` clean, diff limited to the three files, no version bump.
- Issue #70 closed (or explicitly handed off ready-to-close).
