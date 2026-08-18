# Plan — SSSF visualiser as a virtual "Traces" tab in each workspace (v3, post-council)

## What you get

Open a workspace in Collie whose repo has ADW traces (`adws/adw_data/sssf.db`). Its tab strip
shows one extra tab at the end — the SSSF three-lanes icon, labelled "Traces", not a number — so it
reads as "not a Herdr tab". Tap it and the pane area becomes the SSSF trace UI (sessions, lanes,
context bars, prompts) for **that repo's** db, laid out for a phone. Workspaces without traces get
no tab.

The visualiser source stays where it is (`~/.claude/skills/sssf/apps/visualizer`). Collie points at
that folder via `.env`, builds it into Collie's own state dir, and serves it. Nothing from it is
copied into the Collie repo. Editing the visualiser → restart Collie → rebuilt.

## Decisions already made — do not re-litigate

- **Point, don't copy.** `SSSF_VIZ_DIR` names the folder; the Collie repo contains none of it.
- **In-process.** The bridge imports the visualiser's `server/db.ts` (behind a contract check) and
  declares the API under `/sssf/api/*`. `server/index.ts` is never imported (it calls `Bun.serve`).
- **Per-workspace db, discovered automatically** from Herdr pane cwds. No `SSSF_DB`, no switcher.
- **Collie-only virtual tab**, rendered as a **sandboxed** iframe of `/sssf/?ws=<id>&embed=1#/`.
- **The visualiser gets a proper phone + embed pass, in the visualiser.** These are generic
  improvements (BASE_URL-relative URLs, mobile breakpoint, touch targets, embed mode) that make sense
  upstream, not Collie-specific hacks. Collie checks they're present and disables itself if not.
- `SSSF_VIZ_DIR` unset → feature off. No tabs, `/sssf/*` 404s. Collie behaves exactly as today.
- Delivery: branch → PR after this plan is approved. Visualiser edits go in first (they stand alone).

## Part A — visualiser edits (`~/.claude/skills/sssf/apps/visualizer`)

All backwards compatible: `just obs` at `/` looks and works as before on a desktop.

| File | Edit | Why |
|---|---|---|
| `src/lib/api.ts` | prefix every URL with `import.meta.env.BASE_URL`; if the page URL has `?ws=`, forward it as `?ws=` on every API call | Under `/sssf/` the bare `/api/...` would hit Collie's own API. `ws` picks the workspace's db. |
| `src/lib/models.ts` | `BASE_URL` prefix on the three `/models/*.png` paths | Same. |
| `src/App.vue` | `embed = new URLSearchParams(location.search).has('embed')`. In embed mode the header collapses to a **one-line crumb bar** (logo + `sessions › adw › phase`, no brand text/live dot) — NOT hidden | The crumbs are the only way back from a trace to the list; iOS standalone PWA has no back gesture. Saves height without trapping the user. |
| `src/style.css` (+ per-component styles) | `@media (max-width: 640px)`: session cards `minmax(0, 1fr)` instead of `460px`; lane header column ~110px (or stacked above the track) instead of `280px`; trace panel margins 12px | Today a 390px screen gets a sideways-scrolling card grid and ~80px of lane timeline. |
| same | `@media (hover: none)`: archive `×` always visible; context used/window numbers and phase status rendered as text, not `title=` tooltips; `overscroll-behavior: none` on body in embed mode | No hover on a phone; `title` never shows; pull at top of list triggers Android pull-to-refresh of the whole PWA. |
| `SessionsList.vue`, `SessionTrace.vue`, `SessionCard.vue` | polling: 2 s in embed mode (500 ms today), paused while `document.hidden` | 2+ req/s over Tailscale on a phone, forever. |
| `SessionCard.vue` | on archive 403, show "this device is read-only" instead of silently re-syncing the card back | Archive is write-gated in Collie; today the card vanishes then reappears with no message. |

Not edited: `vite.config.ts` (base and outDir come from CLI flags, below), `server/*`, router (hash
routing works under any base; hash changes inside the iframe don't touch Collie's URL).

## Part B — Collie

### How Collie finds each workspace's db

Herdr's `workspace.list` has no directory; panes report `cwd`. For each workspace, walk each pane cwd
upward (max 8 levels) and accept a directory only if it holds **both** `adws/adw_data/sssf.db` and
`.git` (a worktree root) — never an arbitrary ancestor, so a planted `~/adws/adw_data/sssf.db` is
ignored. First hit wins. Cached per workspace; re-checked when the workspace's pane set changes,
on the first snapshot after startup, and every 30 s. Snapshot carries only a flag:
`workspace.sssf: "ready" | "pending" | undefined` — `pending` when an `adws/` dir exists but no db
yet (chip shows greyed "no traces yet"). The path stays server-side and is looked up by workspace
id on every `/sssf/api/*` call. A client can never name a file.

### `bridge/sssf-viz.ts` (new, ~200 lines) — the whole feature lives here

- Reads `SSSF_VIZ_DIR` itself (`~` expanded, absolute). Not added to `Config`.
- **Startup contract check**, all-or-nothing, one warning + disabled on any miss:
  - folder exists, `bun` on PATH, `server/db.ts` present;
  - dynamic-import `db.ts`, `typeof` check the members used (`SssfDb` ctor, `.path`,
    `.journalMode`, `.sessionsDir`, `sessions`, `session`, `sessionDetail`, `events`, `envelopes`,
    `gates`, `setArchived`, `sessionCount`);
  - the Part A patches are present (`api.ts` contains `BASE_URL`) — a skill re-install that wipes
    them disables the feature loudly instead of building a broken UI. Log the visualiser's
    `package.json` version.
- **Build** into `${stateDir}/sssf-viz/dist` (state dir is Collie's only write path; the skill
  folder is not written except by `bun install` below):
  - stale when `dist/index.html` is missing or older than any file under `src/`, `shared/`,
    `public/`, `index.html`, `package.json`, `bun.lock`, `vite.config.ts`;
  - `bun install --frozen-lockfile` in `vizDir` (only when `node_modules` missing or `bun.lock`
    newer than it) with a scrubbed env — no `COLLIE_*`, no socket path — then
    `bunx vite build --base=/sssf/ --outDir=<target> --emptyOutDir` (CLI flags, no config edit);
  - background at startup; log the source content hash so a rebuild is a visible, deliberate
    event; `/sssf/` answers 503 "building" until done.
- **Routes**, all under `/sssf/api/`, all taking `?ws=`, 404 if that workspace has no db:
  - `GET health | sessions | sessions/:id | …/events | …/envelopes | …/gates | …/agents/:agent/prompts`
    → `guard(req, cfg, "read")`
  - `POST sessions/:id/archive` → `requireJsonBody` + `guard(req, cfg, "write")`
  - handlers wrapped in Collie's `failureText` (never `error.message`); `health` returns
    `{ok, sessions}` only — no absolute db path;
  - `isSafeSegment` on every path segment; the prompts read goes through
    `containedRealpath(candidate, sessionsDir)` from `bridge/journal/files.ts` (symlink-safe) with a
    256 KB byte cap and honours `COLLIE_TRANSCRIPT=off`.
- **Static:** `/sssf/*` from the built dist via `resolveStaticPath`, SPA fallback, Collie's
  security headers. **`isHostAllowed` runs first**, before the `/sssf`→`/sssf/` 301, the 503 and the
  404 — same reason as `serveStatic`: a rebound host can't probe feature state.
  **CSP** on its `index.html`: Collie's CSP with `frame-ancestors 'self'` (Collie's own pages keep
  `'none'`).

### One-line hooks in upstream-owned files (merge surface kept minimal)

| File | Hook |
|---|---|
| `bridge/server.ts` | top of `fetch`: `if (sssfViz.owns(pathname)) return sssfViz.handle(req, url, cfg);` and in `/api/snapshot`: `workspaces: sssfViz.decorate(workspaces)` |
| `bridge/types.ts` + `web/src/lib/types.ts` | `WorkspaceView.sssf?: "ready" \| "pending"` |
| `web/src/components/tab-strip.tsx` | `{workspace.sssf && <SssfChip …/>}` after the Herdr chips. `TabStrip` is also rendered inside `agent-chat.tsx` / `space-view.tsx` — the chip appears only in the space-level strip. |
| `web/src/routes/space.tsx` | `tab === "sssf"` → `<SssfFrame/>` instead of `SpaceView` |
| `web/src/lib/sw-routes.ts` | `/^\/sssf(\/|$)/` in `NAVIGATION_NETWORK_ONLY` (else the PWA's service worker answers the iframe with Collie's cached shell) |

### `web/src/components/sssf-frame.tsx` (new, ~50 lines)

- `SssfChip`: three-lanes SVG + "Traces"; greyed + disabled when `pending`. Re-tapping the active
  chip posts `#/` to the iframe (back to the list).
- `SssfFrame`: `<iframe sandbox="allow-scripts" src="/sssf/?ws=<id>&embed=1#/">`. **No
  `allow-same-origin`** → opaque origin → the visualiser's JS cannot call Collie's `/api/*` (reads on
  `/sssf/api/*` accept a missing/`null` Origin the way `checkAccess` already does for reads; the
  archive write is dropped in embed mode — the button hides when `embed`). Rendered as the **sole
  scroller**: outer container `overflow-hidden`, iframe `h-full`, update banner / build stamp not
  rendered. Kept mounted but `hidden` while another tab is selected, so the run you were watching
  survives a tab switch.

### Docs / config

- `.env.example`: `SSSF_VIZ_DIR` + comment. `README.md`: "SSSF traces tab" under Configure.
  `CHANGELOG.md` entry. `.adr/0011-sssf-is-the-second-filesystem-reader.md`: why a module outside
  `bridge/journal/` touches the filesystem and how it's contained.

## Not doing

- No Vue→React port. No manual "add traces tab". No live-reload (restart Collie; or `bun run dev`
  in the visualiser folder as today). Tab not deep-linkable (matches Collie's ephemeral tab state).
- Not vendoring `db.ts` (418 lines; the contract check + a `bun test` that imports the real
  `db.ts` when `SSSF_VIZ_DIR` is set catches drift instead).

## Security notes

- Same gates as every Collie route; one write (archive) needs the device allowlist and is off in
  embed mode anyway.
- The visualiser's built JS runs at Collie's origin **only outside the sandbox** (i.e. `just obs`
  or a direct visit to `/sssf/`); inside Collie's tab it's sandboxed. Its `bun install` is
  lockfile-frozen; the build runs with a scrubbed env. It is still code Collie executes at build
  time — the skill folder is in Collie's trusted computing base, and the ADR says so.
- Prompts files are agent-written; symlinks are resolved and contained under `sessionsDir` before
  reading, capped at 256 KB. Discovery accepts only worktree-root dbs.
- Nothing is written outside `${stateDir}` except `node_modules` in the visualiser folder.

## Rough size

~200 lines new bridge module, ~50 lines new React component, ~10 lines of one-line hooks, an ADR,
docs. Visualiser: ~7 files touched, mostly CSS — one afternoon. One PR in Collie; the visualiser
edits are separate (skill folder, not a repo).

## Council findings folded in (2026-08-18)

1. build/import fragility → CLI-flag build, frozen lockfile, contract check, patch check.
2. filesystem trust → `containedRealpath` + cap, worktree-root-only discovery.
3. phone-readiness → Part A pass; crumb bar kept in embed.
4. same-origin iframe → `sandbox="allow-scripts"`, archive off in embed.
5. upstream merge surface + leaks → one-line hooks, `failureText`, no db path, host check first.
6. nested scroll / remount / discovery lag → sole scroller, mounted-hidden, pane-change recheck, pending chip.
