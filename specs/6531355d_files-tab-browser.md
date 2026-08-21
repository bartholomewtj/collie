# Plan — Files tab: a read-only browser of the operator's work directory

Collie gets a fourth bottom-bar destination, **Files**. It lists the folders and files under one
directory the operator names with `COLLIE_WORK_ROOT`, lets you walk into folders, search filenames as
you type, preview a text file, copy its path, and download any file to the phone. Nothing can be
written, renamed, deleted, uploaded, or sent to a pane. The whole feature is inert — no tab, no
routes — when the env var is unset.

Target version: **0.52.4 → 0.53.0** (MINOR: a new capability; existing setups keep working untouched).

---

## 1. What you are building, in one picture

```
COLLIE_WORK_ROOT=C:\claudeos          (operator sets it; unset = feature off)
        │
   bridge/workdir.ts                  filesystem reader #3 — the ONLY new bridge module
        │  owns()/handle() + enabled   (mirrors bridge/sssf-viz.ts's shape)
        │
   GET /api/files?path=<rel>          dir listing OR file preview (read-level)
   GET /api/files/search?q=<text>     filename search across the root (read-level)
   GET /api/files/download?path=<rel> the bytes, as an attachment (read-level)
        │
   snapshot: { files: true }          only when enabled → BottomNav shows the tab
        │
   web /files  and  /files/*          list destination + pushed folder/file screens
```

Three rules hold the whole thing together, and every review of this work should check them first:

1. **The client never names a host absolute path.** It sends a path *relative to the root*, always
   with forward slashes. Every response carries relative paths only. The root string never leaves
   the bridge.
2. **Containment is checked after symlink resolution, on the real paths** — the same
   `containedRealpath` the journal uses (`bridge/journal/files.ts`). A symlink inside the root that
   points outside it is refused, not followed.
3. **The refusal list is applied to every segment of a path, not just to listings.** Hiding `.env`
   from a listing is not enough; a typed path straight at it must 404 too.

---

## 2. Read these before you write code

- `bridge/sssf-viz.ts` — lines 1–60 (module header + `SssfHelpers`), `readVizDir` (~line 190),
  `readPrompts` (~line 680), `SAFE_SEGMENT` (~line 150), `findRepos` (~line 766). This is the shape
  you are copying: one file, a helpers object passed in from `server.ts`, `owns()/handle()`, inert
  when its env var is unset.
- `bridge/journal/files.ts` — the whole file (119 lines). `containedRealpath` is the invariant.
- `bridge/server.ts` — lines 189–242 (how `sssfViz` is constructed and dispatched), 1416–1530
  (`isStateChangingMethod`, `checkAccess`, `guard`), 1715–1730 (`resolveStaticPath`).
- `.adr/0024-the-sssf-module-is-the-second-filesystem-reader.md` — the terms your ADR restates.
- `web/src/components/bottom-nav.tsx`, `web/src/routes/root.tsx` (the `showNav` line and
  `anyTraces`), `web/src/routes/traces.tsx` lines 1–70 (list → detail → back shape), `web/src/router.tsx`.

---

## 3. Bridge

### 3.1 `bridge/config.ts` — one new field

Add to `interface Config` (near `stateDir`, with a doc comment):

```ts
  /**
   * The one directory the read-only Files tab serves, absolute and `~`-expanded. Empty string = the
   * feature is off: no tab, no /api/files* routes, nothing on disk is touched.
   */
  workRoot: string;
```

Add a `readWorkRoot(env)` exported helper — copy `readVizDir` in `bridge/sssf-viz.ts` verbatim in
shape: trim, `""` when unset, expand a leading `~`/`~/`/`~\`, `resolve()` a relative value to
absolute. Export it so the test can exercise it without the environment.

In `loadConfig()` return object: `workRoot: readWorkRoot(),`.

**Also update the two hand-written `Config` fixtures** or the build breaks on `noUnusedLocals`-strict
tsc: `bridge/server.test.ts` (~line 85) and `bridge/sssf-viz.test.ts` (~line 57) — add
`workRoot: ""` beside `skipServe: false`.

### 3.2 `bridge/workdir.ts` — the new module (filesystem reader #3)

Name it `workdir.ts`, **not** `files.ts` — `bridge/journal/files.ts` already owns that name and
confusing the two is exactly the kind of mistake that gets a containment check skipped.

Write a module header comment in this repo's register — say what it does, then why the rules are
what they are. It must state: this is reader #3, it is off unless `COLLIE_WORK_ROOT` is set, every
path is contained after symlink resolution, and the client never sees an absolute path.

**Constants (all exported, all pinned by tests):**

```ts
const MAX_ENTRIES = 2000;        // dirents returned for one directory listing
const PREVIEW_CAP_BYTES = 512 * 1024;   // most text we ever put in a preview
const DOWNLOAD_CAP_BYTES = 100 * 1024 * 1024; // refuse to stream anything larger
const SEARCH_MAX_DEPTH = 8;      // levels below the root the name search walks
const SEARCH_MAX_RESULTS = 200;  // results returned; `truncated: true` past it
const SEARCH_MAX_DIRS = 5000;    // directories visited before the walk gives up
const BINARY_SNIFF_BYTES = 8192; // bytes read to decide "is this text"
```

**`isRefusedName(name: string): boolean` — the skip list.** Two rules, both case-insensitive:

- **Any name starting with `.` is refused.** One rule that covers `.env`, `.env.local`, `.envrc`,
  `.git`, `.ssh`, `.aws`, `.npmrc`, `.git-credentials`, `.cache`, `.venv` and every dot-secret
  nobody has invented yet. It is deliberately broader than "hide secrets": a fail-closed rule you
  can state in one sentence beats a list that grows a hole every time someone adds a dotfile. Say so
  in the comment — a future contributor *will* propose un-hiding `.adr/`.
- **A fixed name/pattern list on top, for the non-dot cases:** `node_modules`, `config`, `__pycache__`,
  `venv`, `target`, `vendor`, `Thumbs.db`, `desktop.ini`; and file names matching
  `/\.(pem|key|pfx|p12|kdbx|keystore|jks)$/i` or `/^id_(rsa|ecdsa|ed25519)/i`.

`config` is refused because the operator's root is `C:\claudeos`, whose `config/` holds their private
global instructions. It is a deliberate over-refusal — a repo's innocuous `config/` folder is
collateral. Note that in the comment and in the README so nobody "fixes" it later.

**`parseRelPath(raw: string): string[] | null` — the path parser.** The single door every request
path goes through. Returns the segment list, or `null` (caller → 404) when *any* of these hold:

- the string contains a NUL or any control character (`\u0000`–`\u001f`);
- it contains a backslash (Windows separator — the wire format is forward slashes only, so a
  backslash is either an escape attempt or a filename we refuse to disambiguate);
- it is absolute (`/`-leading, or matches `/^[A-Za-z]:/` — a drive letter);
- a segment is empty, `.`, or `..`;
- a segment contains `:` (Windows drive / NTFS alternate data stream);
- a segment is refused by `isRefusedName`;
- the total length exceeds 1024 chars or the segment count exceeds 32.

`""` is valid and means the root itself. Export it for tests.

**`resolveInRoot(root, segs): Promise<string | null>`** — `join(root, ...segs)`, then
`containedRealpath(candidate, root)` from `./journal/files.ts`. Return the real path or null. This
is the only place a filesystem path is built. Never call `realpath` and compare strings yourself;
never build a path anywhere else in the module.

**`createWorkdir(cfg: Config, h: WorkdirHelpers)` → `{ enabled, owns(pathname), handle(req, url) }`**,
where `WorkdirHelpers` is `{ guard, json, text, failureText, contentTypes }` passed in from
`server.ts` (same pattern as `SssfHelpers`, so the two files don't import each other).

- `enabled` = `cfg.workRoot !== ""`.
- `owns(pathname)` = `enabled && (pathname === "/api/files" || pathname.startsWith("/api/files/"))`.
  When `enabled` is false `owns()` is false, so the routes simply do not exist — the request falls
  through to the static handler and 404s exactly as it did before this feature.
- `handle` runs `h.guard(req, cfg, "read")` first on every route, refuses anything that is not
  `GET`/`HEAD` with a 405, wraps its body in try/catch → `h.text(h.failureText("files", err), 500)`.

**Route 1 — `GET /api/files?path=<rel>`.** One endpoint that answers "what is at this path", because
the client does not know whether a tapped row is a folder or a file until the bridge says so.

```jsonc
// directory
{ "kind": "dir", "path": "Projects/tools", "entries": [
  { "name": "collie", "kind": "dir",  "mtimeMs": 1755800000000 },
  { "name": "README.md", "kind": "file", "size": 4210, "mtimeMs": 1755800000000 }
], "truncated": false }

// text file
{ "kind": "file", "path": "Projects/tools/collie/README.md", "name": "README.md",
  "size": 42100, "mtimeMs": 1755800000000, "text": "# Collie…", "truncated": false, "binary": false }

// binary or oversized file — no text, the client offers download only
{ "kind": "file", "path": "assets/demo.mp4", "name": "demo.mp4",
  "size": 8400000, "mtimeMs": 1755800000000, "binary": true }
```

- Directory: `readdir(real, { withFileTypes: true })`, drop every entry `isRefusedName` refuses, drop
  anything that is neither `isDirectory()` nor `isFile()` (a `Dirent` for a symlink reports neither,
  so links are simply not listed — same call the sssf down-scan relies on), `slice(0, MAX_ENTRIES)`
  with `truncated` set when it bit. Sort directories first, then by name with
  `localeCompare(b, undefined, { numeric: true, sensitivity: "base" })`. `stat` each surviving entry
  for size/mtime; a `stat` that throws (a file deleted mid-listing) drops the entry rather than
  failing the request.
- File: `stat` for size. Read `min(size, BINARY_SNIFF_BYTES)` bytes; if any byte is `0x00`, or the
  slice fails to decode as UTF-8 (`new TextDecoder("utf-8", { fatal: true })` throws), report
  `binary: true` and send no text. Otherwise read `min(size, PREVIEW_CAP_BYTES)` via
  `Bun.file(real).slice(0, PREVIEW_CAP_BYTES).text()` and set `truncated` when `size` exceeded the
  cap. Never read the whole file into memory unconditionally.
- A missing path, a refused path, a containment failure and a path that is neither file nor
  directory all answer the **same** 404 `{ "error": "not found" }`. A refusal must not be
  distinguishable from an absent file — that is the rule `containedRealpath` already follows and it
  is what stops the endpoint from being a probe for what exists outside the root.

**Route 2 — `GET /api/files/search?q=<text>&limit=<n>`.** Filename substring match,
case-insensitive, across the whole root.

```jsonc
{ "q": "loader", "results": [
  { "path": "web/src/lib/loaders.ts", "name": "loaders.ts", "kind": "file" }
], "truncated": false }
```

- `q` is trimmed; fewer than 2 characters → `{ q, results: [], truncated: false }` with no walk at
  all (an empty query must never trigger a full-tree scan on every keystroke).
- Breadth-first walk from the root. Never enter a directory whose name `isRefusedName` refuses.
  Never follow a symlink (`Dirent.isDirectory()` is false for one). Stop at `SEARCH_MAX_DEPTH`,
  `SEARCH_MAX_DIRS` visited, or `SEARCH_MAX_RESULTS` collected — set `truncated: true` for any of
  the three, so the UI can say "showing first 200".
- Match on the **entry name only**, not the path (that's what the prompt asked for and it keeps the
  result list readable on a phone).
- Results carry the relative POSIX path. Directories are results too — tapping one navigates.

**Route 3 — `GET /api/files/download?path=<rel>`.** Same parse + resolve. Must be a regular file.
Refuse over `DOWNLOAD_CAP_BYTES` with a 413. Stream it:

```ts
return h.secure(new Response(Bun.file(real), { headers: {
  "content-type": h.contentTypes[extname(real).toLowerCase()] ?? "application/octet-stream",
  "content-disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  "content-length": String(size),
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
}}));
```

`Response(Bun.file(...))` streams from disk — do not `await file.arrayBuffer()`, a 100 MB video would
balloon the bridge. `asciiFallback` is `name` with every non-ASCII and every `"` / `\` / control char
replaced by `_`; the `filename*` form carries the real name. **Always `attachment`, never `inline`** —
an inline `text/html` from the work root would execute same-origin against the bridge, which is a
typed keystroke into a real terminal one CSP bypass away.

### 3.3 `bridge/server.ts` — the hooks (keep it to four lines)

1. `import { createWorkdir } from "./workdir.ts";`
2. Beside the `createSssfViz(...)` call (~line 191):
   ```ts
   // The Files tab (bridge/workdir.ts). Inert unless COLLIE_WORK_ROOT is set; borrows the gate and
   // response helpers below rather than importing this file back.
   const workdir = createWorkdir(cfg, { guard, json, text, failureText, secure, contentTypes: CONTENT_TYPES });
   ```
   `json`/`text`/`secure` are module-local in `server.ts` — pass them in the helpers object; do not
   export them just for this.
3. In `fetch`, immediately after the `sssfViz.owns` line (~232):
   ```ts
   if (workdir.owns(pathname)) return workdir.handle(req, url);
   ```
   Above the session-scoped routes: Files is global, not per-Herdr-session, and ignores `?session=`.
4. In the `/api/snapshot` response object, beside `update`:
   ```ts
   // Only when on, so a bridge without a work root ships a byte-identical payload.
   ...(workdir.enabled ? { files: true as const } : {}),
   ```
   and add `files?: boolean` to the snapshot type in `bridge/types.ts` with a one-line comment.

### 3.4 `bridge/types.ts`

Add the wire types the module returns (`WorkdirEntry`, `WorkdirListing`, `WorkdirFile`,
`WorkdirSearchResult`) so `web/src/lib/types.ts` can mirror them, and `files?: boolean` on the
snapshot type.

---

## 4. Web

### 4.1 `web/src/lib/types.ts`

Mirror the bridge wire types (`FileEntry`, `FilesResponse` as a discriminated union on `kind`,
`FileSearchResponse`) and add `files?: boolean` to `SnapshotResponse` with a comment: *"True when the
bridge serves a work root — the Files tab shows only then. Absent on a bridge without one."*

### 4.2 `web/src/lib/api.ts`

Three functions, in the style of `fetchConfig` (which is the closest existing shape):

```ts
export function fetchFiles(path: string, signal?: AbortSignal): Promise<FilesResponse>
export function searchFiles(q: string, signal?: AbortSignal): Promise<FileSearchResponse>
export function downloadFileUrl(path: string): string   // pure — builds the /api/files/download URL
```

`downloadFileUrl` returns a same-origin URL used as an `<a download href>`. That anchor is a
navigation, not a `fetch`, so it carries no `Origin` — which passes `checkAccess` at read level
(browsers omit `Origin` on same-origin GETs; the code path is the `else if` at server.ts:1469 and it
only bites state-changing methods). `/api/` is already in `NAVIGATION_NETWORK_ONLY`
(`web/src/lib/sw-routes.ts`), so the service worker hands the navigation to the network instead of
answering it with the precached shell. **Do not add anything to that denylist** — verify the existing
`/^\/api\//` entry covers you and move on.

### 4.3 `web/src/lib/nav.ts`

```ts
/** The Files browser (the bottom bar's Files destination) — the operator's work root. */
export function filesPath(session?: string): string

/** One folder or file inside the work root. `rel` is a forward-slash path relative to the root; each
 *  segment is encoded separately so a name with a slash-safe character survives the round trip. */
export function filePath(rel: string, session?: string): string
```

`filePath("a/b c.md")` → `/files/a/b%20c.md`. Encode per segment with `encodeURIComponent` and rejoin
with `/`; do **not** `encodeURIComponent` the whole path (it would eat the separators).

### 4.4 `web/src/router.tsx`

Two children beside the traces pair:

```tsx
{ path: "files", loader: filesLoader, element: <FilesRoute />, shouldRevalidate: () => false },
{ path: "files/*", loader: filesLoader, element: <FilesRoute />, shouldRevalidate: () => false },
```

`shouldRevalidate: () => false` for the same reason `pane/:paneId/history` has it: the root loader
polls every ~1.5 s and re-running a directory read (or a file preview) on every tick is pure waste.
Copy that comment's reasoning into a short one here.

### 4.5 `web/src/lib/loaders.ts`

Add `filesLoader({ params, request })`: read the splat (`params["*"] ?? ""`), decode each segment,
call `fetchFiles(rel, request.signal)`, return `{ rel, data }`. On error return
`{ rel, error: message }` and let the route render it — same stale-tolerant posture as the other
loaders, minus the module cache (a directory listing is not worth caching). Rethrow `AbortError` the
way the existing loaders do.

### 4.6 `web/src/routes/files.tsx` (new)

One component, branching on `data.kind`, in the repo's list → detail → back shape.

- **Header.** `AppHeader` with the current folder name (or "Files" at the root). At the root there is
  no `onBack` — it is a bottom-bar destination. Below the root, `onBack` navigates up exactly one
  level (`filePath(parentOf(rel))`, or `filesPath()` when the parent is the root). One back rule, no
  second way home — this is the rule in `CLAUDE.md` → *Navigation*.
- **Search row.** A text input pinned under the header, `type="search"`, `inputMode="search"`,
  `autoCapitalize="off"`, `autoCorrect="off"`. Debounce **200 ms**; abort the previous request with
  an `AbortController` on every new keystroke. Fewer than 2 chars → clear results and show the
  directory listing again. While results are showing, the listing is replaced (not appended) and a
  small "Showing first 200 matches" line appears when `truncated`.
- **Rows.** Folder: folder icon, name, chevron; tap → `navigate(filePath(childRel))`. File: file
  icon, name, `size` humanised + `timeAgo(mtimeMs)` on the second line (both helpers already exist in
  `web/src/lib/format.ts`); tap → `navigate(filePath(childRel))`, which loads the file view.
- **File view** (`data.kind === "file"`):
  - a monospace `<pre>` of `data.text`, wrapped, with a "truncated at 512 KB" note when
    `data.truncated`. **Render as a React text node — never `innerHTML`.** This is the same XSS
    boundary as the pane mirror and the file content is arbitrary bytes off disk.
  - **Copy path** — `navigator.clipboard.writeText(rel)` with a `document.execCommand("copy")`
    fallback on a textarea for the WebViews that lack it; flip the button label to "Copied" for
    ~1.5 s. It copies the **relative** path, which is all the client has.
  - **Download** — an `<a href={downloadFileUrl(rel)} download={data.name}>` styled as a button.
  - `data.binary` → no `<pre>`; show "Can't preview this file — download it instead" plus the same
    two buttons.
- **Feature-off / not-found.** A 404 from the loader renders a plain empty state ("Files isn't turned
  on — set `COLLIE_WORK_ROOT` on the host" at the root; "Not found" below it). Do not throw — the
  route must not land the user on `RootError`.
- **No mutations of any kind.** No rename, no delete, no upload, no "send to pane". If you find
  yourself importing `sendReply` here, you have gone wrong.

### 4.7 `web/src/components/bottom-nav.tsx` + `web/src/routes/root.tsx`

- `BottomNavProps` gains `files: boolean` with a doc comment matching `traces`'s.
- Insert the Files item **between Traces and Settings**, `icon: FolderTree` (or `Folder`) from
  `lucide-react`, `to: filesPath(session)`, `on: pathname.startsWith("/files")`.
- `root.tsx`: `const showNav = pathname === "/" || pathname === "/traces" || pathname === "/files" || pathname === "/settings";`
  — a *sub*folder is a pushed screen and gets the header back button instead, exactly like
  `/traces/:spaceId/:repo`. Pass `files={data.files === true}`.
- `HomeData` in `loaders.ts` gains `files: boolean`; `rootLoader` maps `snap.files === true`. The
  cached/last-good snapshot path must carry it too, or the tab flickers away during an outage.

---

## 5. Tests

Add `bridge/workdir.test.ts` (Bun's runner; picked up by `bun test ./bridge ./scripts`). Build every
fixture path with `join()` — never by interpolating `/` — or the assertions silently pass on Windows
against a tree the code under test never produces. Guard the symlink test with `CAN_SYMLINK` from
`bridge/platform-support.ts` and plant that fixture conditionally so one `EPERM` doesn't take the
file down with it.

| # | Covers | Assert |
|---|--------|--------|
| 1 | `readWorkRoot` | unset/whitespace → `""`; `~/x` → no `~` left; `rel/dir` → absolute |
| 2 | `parseRelPath` refusals | `..`, `a/../b`, `/abs`, `C:\x`, `a\b`, `a//b`, `a/.`, NUL, a 33-segment path, a name with `:` → all `null` |
| 3 | `isRefusedName` | `.env`, `.env.local`, `.git`, `.ssh`, `node_modules`, `config`, `server.pem`, `id_rsa`, `__pycache__` → true; `README.md`, `bridge`, `notes.txt` → false |
| 4 | Listing | temp tree with `.env`, `node_modules/`, `config/`, `a.txt`, `sub/` → response lists **only** `a.txt` and `sub`, dirs first |
| 5 | **Typed path refusal** | `GET /api/files?path=.env` and `?path=node_modules/pkg/index.js` → 404, even though both exist on disk |
| 6 | **Containment** (`CAN_SYMLINK`) | a symlink inside the root pointing at a file outside it → `?path=link` 404s, and the target's bytes never appear in any response |
| 7 | Preview caps | file under cap → full text, `truncated: false`; file over `PREVIEW_CAP_BYTES` → `truncated: true` and `text.length === PREVIEW_CAP_BYTES`; a file with a `0x00` byte → `binary: true`, no `text` key |
| 8 | Search | `q` matches case-insensitively on the name; a match inside `node_modules/` is absent; `q: "a"` (1 char) returns `[]`; results cap sets `truncated` |
| 9 | Download | correct `content-disposition: attachment`, correct `content-length`; over `DOWNLOAD_CAP_BYTES` → 413; refused/typed-escape path → 404 |
| 10 | **Feature off** | `createWorkdir(cfg({ workRoot: "" }), …)` → `enabled === false`, `owns("/api/files")` false, `owns("/api/files/search")` false |
| 11 | Gate | with `workRoot` set but a cross-origin `Origin` header → 403 from `guard`, not a listing |

Web (Vitest + jsdom + Testing Library):

- **`web/src/components/bottom-nav.test.tsx` (new).** With `files={false}` there is no "Files"
  button; with `files={true}` there is, it sits between Traces and Settings, and clicking it
  navigates to `/files`. Also assert the existing Traces behaviour so the file covers both flags.
- **`web/src/routes/files.test.tsx` (new).** With MSW stubbing `/api/files`: a directory renders its
  rows and tapping a folder navigates; typing 3 characters fires exactly one `/api/files/search`
  after the debounce (fake timers) and renders the results; a `binary: true` file shows the download
  affordance and no `<pre>`; the copy button writes the relative path to a stubbed
  `navigator.clipboard`.

Run all of it:

```bash
bun run build                 # typechecks bridge + web, then builds web
bun test ./bridge ./scripts   # or: bun run test  (adds the ctl lifecycle suite)
cd web && bun run test
bash scripts/check-version.sh # must print ✓
bash scripts/check-doc-links.sh
```

---

## 6. Docs, ADR, version

### 6.1 `.adr/0026-the-files-tab-is-the-third-filesystem-reader.md` (new)

Nygard format, `Status: **Accepted** (2026-08-22)`. It clears the ADR bar because it re-opens a
settled boundary — ADR 0024 said "any third claimant should expect the same terms", and someone will
reasonably propose widening this one (make it writable, drop the dot-file rule, serve `inline`).

- **Context.** ADR 0024 allowed a second filesystem reader on stated terms. A phone browser of the
  operator's work directory is a third. Name the alternatives you are closing off: serving the tree
  with no opt-in env var (every deployment suddenly exposes `$HOME`); an allow-list of extensions
  instead of a refusal list (fails open on the file nobody thought of); `inline` disposition so the
  phone previews a PDF in place (an HTML file from the work root would then run same-origin against
  the bridge).
- **Decision.** Allow `bridge/workdir.ts` on ADR 0024's terms: opt-in via `COLLIE_WORK_ROOT` (unset =
  the routes do not exist); containment via `containedRealpath` **after** symlink resolution on every
  path, including a path the client typed; byte and dirent caps on listing, preview, search and
  download; the client never sees a host absolute path; **read-only — no route in this module accepts
  a state-changing method**; refusal is fail-closed (every dot-name, plus a named list) and a refusal
  is indistinguishable from an absent file; downloads are always `attachment`.
- **Consequences.** A third module claims filesystem access; `CLAUDE.md` is amended to name it. The
  dot-name rule hides legitimately interesting folders (`.adr/`) — that is the price of a rule you
  can state in one sentence. Making this writable, or adding send-to-pane, is a new ADR, not a PR.

### 6.2 `CLAUDE.md`

In the *"The journal (scrollback the mirror can't give you)"* section, amend the sentence that names
the sanctioned readers so it reads two → three, linking `bridge/workdir.ts` and the new ADR. Then add
a short normative block (no reasoning — that lives in the ADR):

> **The Files tab is read-only and opt-in.** `bridge/workdir.ts` serves one directory named by
> `COLLIE_WORK_ROOT`; unset means the routes don't exist and the tab doesn't show. Every path is
> parsed to relative segments, refused against the skip list, and contained with `containedRealpath`
> after symlink resolution — a typed path at `.env` 404s like an absent file. Downloads are always
> `attachment`. Don't add a write route, an upload, or send-to-pane
> ([ADR 0026](./.adr/0026-the-files-tab-is-the-third-filesystem-reader.md)).

### 6.3 `CONTEXT.md`

Four edits, all small:

- §2 tree (~line 55): add `└─ workdir.ts (Files tab — filesystem reader #3)`.
- §3 module table: `| `workdir.ts` | Read-only browser of `COLLIE_WORK_ROOT` — list, name search, preview, download. Filesystem reader #3. |`
- §3 `/api/*` table: the three new routes, all read-level.
- §4 route table: `/files`, `/files/*` → `web/src/routes/files.tsx`.
- §6 change-impact + §7 fast-navigation: a `Files tab` row →
  `bridge/workdir.ts` · `web/src/routes/files.tsx` · `web/src/lib/nav.ts`.

Every backticked path you add must exist, or `scripts/check-doc-links.sh` fails the commit.

### 6.4 `README.md`

New `### Files tab` under `## Configure`, directly after `### SSSF traces tab`. Lead with what it
does and how to turn it on, then the limits:

- one line of what it is; `COLLIE_WORK_ROOT=~/Projects` (and the Windows form `C:\claudeos`);
- unset = no tab, no routes;
- **read-only**: preview, copy path, download; nothing can be written;
- what is skipped and that it is skipped **even by typed path**: every dot-name, plus `node_modules`,
  `config`, `__pycache__`, `venv`, `target`, `vendor`, and key/cert file names. Say plainly that
  `config` is refused on purpose;
- the security line: **anything under this root is readable by every device that can reach Collie**,
  so point it at a work tree, not `$HOME`, and not anywhere with credentials or patient data.

### 6.5 `.env.example`

Append a block in the file's existing style, after the SSSF one:

```
# --- Files tab (optional) ---
# Show a READ-ONLY file browser of one directory on the host: walk folders, search filenames,
# preview text, copy a path, download a file to your phone. Nothing can be written, renamed or
# deleted. Unset = the tab is hidden and /api/files* does not exist.
# EVERY device that can reach Collie can read everything under this path — point it at a work tree,
# never at $HOME. Dot-names (.env, .git, .ssh …), node_modules, config, caches and key/cert files are
# refused, including by a typed path.
# COLLIE_WORK_ROOT=~/Projects
```

### 6.6 Version — mandatory, do it as part of the change

Bump to **0.53.0** in `herdr-plugin.toml`, `package.json`, `web/package.json`, and add:

```markdown
## [0.53.0] - 2026-08-22

### Added
- Files tab: read-only browser of `COLLIE_WORK_ROOT` — walk folders, search filenames as you type, preview text, copy a path, download to the phone (abc1234)
- Hidden entirely when `COLLIE_WORK_ROOT` is unset; dot-names, `node_modules`, `config`, caches and key files are refused even by typed path (abc1234)
```

Land the functional commits first, then cut the release commit so the entries can cite real short
hashes. Then `bash scripts/check-version.sh` must print `✓`. Push an annotated tag with the release:
`git tag -a v0.53.0 -m "Collie 0.53.0" && git push --follow-tags`.

Branch + PR, per the working rules — this is well beyond a single-file edit.

---

## 7. Traps specific to this repo

- **Backend changes don't hot-reload.** After touching `bridge/`, `systemctl --user restart collie`
  on the deployment host or your change isn't running.
- **Nothing rebuilds `web/dist` for you.** After touching `web/src`, `bun run build` at the root
  (which typechecks both sides) — the bridge serves `web/dist` from disk, so a stale bundle serves
  silently. If the Files tab won't appear, read the build id off `/api/config` before reading code.
- **`web/` enforces `verbatimModuleSyntax` + `erasableSyntaxOnly`** — `import type` for every type
  import in `web/src`, and no parameter-property shorthand there. The bridge does not enforce those
  two and uses parameter-property shorthand by convention; keep each side consistent with itself.
- **`noUnusedLocals`/`noUnusedParameters` are on everywhere** — an unused import in a test file fails
  the build.
- Keep the new bridge logic **pure and injectable**. `bun test` on the bridge can't run `Bun.serve`;
  that's why `parseRelPath`, `isRefusedName`, `readWorkRoot` and the listing/search/preview functions
  must be callable without a server, and why the helpers arrive as an object rather than an import.

## 8. Out of scope

`adws/`. No writes of any kind. No editing, renaming, deleting, moving, uploading, or sending a file
to a pane. No second front door, no new managed ingress. No terminal emulator. No TanStack Query.
