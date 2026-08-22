# Plan — split `bridge/server.ts` into route-group modules

**Version:** 0.55.1 → **0.55.2** (PATCH — internal refactor, no behaviour change)
**Repo:** `C:\claudeOS\Projects\tools\collie` (Windows checkout, Git Bash)

## What this is

`bridge/server.ts` is 1,852 lines and 30 exports. It holds the `Bun.serve` dispatch table plus
every route handler, the access gate, the response helpers, and the static-file server. This
splits it into eight leaf modules under `bridge/`, leaving `server.ts` as the composition root:
config → helpers → `Bun.serve` dispatch.

**Nothing about the running bridge changes.** No route path, no response body, no header, no status
code, no error string, no log line. This is a move-and-import job. If you find yourself rewriting a
function body, stop — you have gone past the brief.

## Baseline — measure before you start

Run these first and write the numbers down. They are the gate at the end.

```bash
cd /c/claudeOS/Projects/tools/collie
bun test ./bridge ./scripts    # expect: 839 pass, 20 skip, 0 fail, 859 tests, 37 files
bunx tsc --noEmit              # expect: clean, exit 0
```

Confirmed baseline on 2026-08-22: **859 tests across 37 files — 839 pass, 20 skip, 0 fail, 2849
expect() calls.** The file count will rise as you split the test file; the *test* count must not
move.

Judge every command by its exit status, not by reading its output for the word "error".

## The eight new files

All flat under `bridge/`, all leaves (none of them imports `server.ts`). Import direction is
strictly one way:

```
responses.ts          (no bridge deps except http-cache.ts)
   ↑
access.ts             (imports responses.ts, config.ts, types.ts)
   ↑
static-assets.ts      (imports responses.ts, access.ts, config.ts, http-cache.ts)
   ↑
pane-read-routes.ts · pane-write-routes.ts · tree-routes.ts · notify-routes.ts · snapshot-route.ts
   ↑
server.ts             (composition root — imports all of the above, re-exports the public names)
```

Below, "lines" are the ranges in the **current** `bridge/server.ts`. Read them before you cut; a few
functions have long doc comments above them that must travel with the function.

---

### 1. `bridge/responses.ts` — how a response is built

Move, verbatim:

| From `server.ts` | Symbol | Export? |
|---|---|---|
| 65–76 | `CONTENT_TYPES` | export |
| 80–85 | `CSP` | export |
| 87–92 | `SECURITY_HEADERS` | module-private |
| 1573–1577 | `secure` | export |
| 1578–1587 | `json` | export |
| 1589–1597 | `jsonError` | export |
| 1598–1600 | `text` | export |
| 1609–1623 | `decodePathSegment` | export (public name) |
| 1625–1633 | `failureText` | export (public name) |
| 1635–1639 | `isJsonContentType` | export (public name) |
| 1641–1650 | `requireJsonBody` | export (public name) |

`CONTENT_TYPES`, `CSP`, `secure`, `json`, `text`, `jsonError` are currently module-private — they
must become exported so the other modules can use them. That is not a public API change: `server.ts`
does **not** re-export them (they were never in its export list), it just imports them.

Imports it needs: `gzipJsonResponse` from `./http-cache.ts`.

Header comment: one paragraph saying this is the single place a Response gets its shape and its
hardening headers, and that `secure()` is the funnel every response passes through.

### 2. `bridge/access.ts` — the gate

Move, verbatim:

| From `server.ts` | Symbol | Export? |
|---|---|---|
| 94–96 | `LOOPBACK_HOST` | module-private |
| 98–118 | `isLoopbackPeer` (+ its doc block) | export (public) |
| 137 | `SEEN_HEADER` | export (public) |
| 139–162 | `marksPaneSeen` (+ doc block) | export (public) |
| 1420–1423 | `isStateChangingMethod` | export (public) |
| 1425–1497 | `checkAccess` (+ its long doc block) | export (public) |
| 1499–1523 | `isHostAllowed` (+ doc) | export (public) |
| 1525–1559 | `guard` (+ doc) | export (public) |
| 1561–1571 | `deviceAuth` (+ its long matrix doc) | export (public) |
| 572–621 | `startupWarnings` (+ doc) | export (public) |

`startupWarnings` lands here because it is the security-posture nag set derived from `Config` — same
subject as the gate, and it is pure.

Imports: `text` from `./responses.ts`; `Config` + `isLoopbackBindHost` from `./config.ts`;
`DeviceAuth` from `./types.ts`.

### 3. `bridge/static-assets.ts` — the PWA on disk, and the build id

Move, verbatim:

| From `server.ts` | Symbol | Export? |
|---|---|---|
| 59–63 | `WEB_DIR`, `WEB_ROOT` | export (`WEB_ROOT` is needed by `server.ts` for `buildFreshness`) |
| 1678–1694 | `buildCache` + `buildId` | export `buildId` |
| 1701 | `BUILD_HEADER` | export (public) |
| 1703–1717 | `withBuildHeader` (+ doc) | export (public) |
| 1719–1739 | `resolveStaticPath` (+ doc) | export (public) |
| 1741–1751 | `isReservedAuthPath` (+ doc) | export (public) |
| 1753–1782 | `reservedAuthPlaceholder` (+ doc) | export (server.ts calls it) |
| 1784–1835 | `serveStatic` | export (server.ts calls it) |
| 1837–1848 | `cacheControlFor` (+ doc) | export (public) |
| 1850–1852 | `isPrivateStaticFile` (+ doc) | export (public) |

Find the exact line where `buildCache` is declared (just above `buildId`) — it is the mtime cache and
must move with it.

Imports: `secure`, `text`, `CONTENT_TYPES`, `CSP` from `./responses.ts`; `isHostAllowed` from
`./access.ts`; `Config` from `./config.ts`; `extname`, `join`, `normalize`, `relative`, `sep` from
`node:path`.

`resolveStaticPath`'s default parameter `webDir: string = WEB_DIR` must stay a default parameter —
`sssf-viz.ts` and its tests call it with an explicit dir, and one backend test relies on the default.

### 4. `bridge/pane-read-routes.ts` — `GET /api/pane/:id` and `/history`

Move, verbatim:

| From `server.ts` | Symbol | Export? |
|---|---|---|
| 55 | `MAX_READ_LINES` | module-private (keep the comment) |
| 124–125 | `DEFAULT_HISTORY_LIMIT`, `MAX_HISTORY_LIMIT` (+ comment) | module-private |
| 623–675 | `readPane` | export |
| 677–684 | `paneReadResponse` (+ doc) | export (public) |
| 686–692 | `historyParams` (+ doc) | export (public) |
| 694–696 | `agentCwdKey` | export — the snapshot route uses it |
| 698–706 | `countPanesPerAgentCwd` | export — the snapshot route uses it |
| 708–718 | `cwdSharedBySibling` | module-private |
| 720–745 | `paneHistoryHint` | module-private |
| 747–795 | `paneHistory` | export |

`readPane` calls `buildId()` and `withBuildHeader` — import both from `./static-assets.ts`.
Also needs `secure`, `text`, `failureText` from `./responses.ts`; `computeEtag`, `gzipJsonResponse`,
`notModified` from `./http-cache.ts`; the journal imports (`adapterFor`, `TranscriptStore`,
`JournalAdapter`) and the types `AgentView`, `PaneRead`, `PaneReadResponse`, `HerdrClient`,
`StateEngine`, `Config`.

Note the `MAX_READ_LINES` comment in `web/src/lib/harness/claude/chrome.ts:31` cites
`bridge/server.ts` for this constant. Update that comment to say `bridge/pane-read-routes.ts`. It is
a comment only — no code change, and `web/` is otherwise out of scope.

### 5. `bridge/pane-write-routes.ts` — reply, keys, upload, close, rename

Move, verbatim:

| From `server.ts` | Symbol | Export? |
|---|---|---|
| 46–52 | `MAX_UPLOAD_BYTES`, `MAX_UPLOAD_OVERHEAD` (+ comments) | module-private |
| 56–57 | `MAX_EXPECTED_PROMPT_CHARS`, `PROMPT_BINDING_BLANK_LINE_HEADROOM` | module-private |
| 797–801 | `ReplySender` | `export interface` (public) |
| 803–812 | `ReplyOutcome` | `export type` (public) |
| 814 | `SleepFn` | `export type` (public) |
| 815 | `defaultSleep` | module-private |
| 817 | `REPLY_SETTLE_MS` | module-private |
| 819–850 | `sendReplySteps` (+ doc) | export (public) |
| 852–913 | `replyPane` | export (public) |
| 915–972 | `keysPane` | export (public) |
| 974–988 | `ExpectedPrompt`, `expectedPrompt` | module-private |
| 990–1010 | `PromptBindingCheck` | module-private |
| 1012–1060 | `checkPromptBinding` | module-private |
| 1062–1077 | `promptBindingFailure` | module-private |
| 1079–1099 | `closePane` | export |
| 1101–1134 | `renamePane` | export |
| 1324–1418 | `uploadPane` | export |

`normalizeLabel` (1136–1146) is used by `renamePane`, `renameTab` and `renameWorkspace`. Put it in
`bridge/tree-routes.ts` (file 6) and import it here; that keeps one home for it. `server.ts`
re-exports it from `tree-routes.ts`.

Imports: `json`, `text`, `secure`, `failureText`, `requireJsonBody` from `./responses.ts`;
`chmod`, `mkdir`, `writeFile` from `node:fs/promises`; `join` from `node:path`;
`imageExtFromBytes`, `makeRoomForUpload`, `SNIFF_BYTES` from `./uploads.ts`; `AuditLog`,
`HerdrClient`, `Config`.

Two comments in `web/` cite `bridge/server.ts checkPromptBinding`
(`web/src/lib/harness/omp/chrome.ts:378`, `web/src/lib/harness/types.ts:50`). Leave them — the
function is module-private now and the file reference is stale either way; retargeting them is
`web/` churn for no gain. If you want them accurate, changing only the file name in those two
comments is acceptable and does not need a `web/` rebuild.

`bridge/uploads.ts:23` and `:82` also mention `server.ts` in comments — retarget to
`bridge/pane-write-routes.ts` (comment-only, same commit).

### 6. `bridge/tree-routes.ts` — tabs and spaces

Move, verbatim:

| From `server.ts` | Symbol | Export? |
|---|---|---|
| 1136–1146 | `normalizeLabel` (+ doc) | export (public) |
| 1148–1176 | `renameTab` | export |
| 1178–1213 | `renameWorkspace` | export |
| 1215–1234 | `closeTab` | export |
| 1236–1277 | `createTab` | export |
| 1279–1322 | `createWorkspace` | export |

Imports: `json`, `text`, `failureText`, `requireJsonBody` from `./responses.ts`; `AuditLog`,
`HerdrClient`, `StateEngine`, and whatever wire types the create handlers use.

### 7. `bridge/notify-routes.ts` — subscribe, snooze, prefs, update check

These four are currently **inline** in the `fetch` body (lines 436–527). Lift each into a function
with explicit parameters — same style as `replyPane`. **The body of each moves verbatim**; only the
surrounding `if (pathname === …)` test stays behind in `server.ts`.

| From `server.ts` | New export | Signature |
|---|---|---|
| 436–459 | `subscribeRoute` | `(req: Request, cfg: Config, push: Push) => Promise<Response>` |
| 461–486 | `snoozeRoute` | `(req: Request, cfg: Config, snooze: Snooze, registry: SessionRegistry, push: Push) => Promise<Response>` |
| 488–518 | `notifyPrefsRoute` | `(req: Request, cfg: Config, notifyPrefs: NotifyPrefsStore, registry: SessionRegistry) => Promise<Response>` |
| 520–527 | `updateCheckRoute` | `(req: Request, cfg: Config, updateMonitor: UpdateMonitor) => Promise<Response>` |
| 1652–1670 | `parseNotifyPrefsPatch` (+ doc) | export (public) |
| 1672–1680 | `supersededEndpoint` | module-private |

Keep every comment inside those bodies — they carry the ADR 0021 / issue #8 reasoning and are the
reason the write-level gate on `/api/subscribe` is not "obviously wrong" to a future reader.

Each route function does its own `guard(req, cfg, …)` call, exactly where it does now — the guard
line moves *into* the function along with the body. Import `guard` from `./access.ts`.

`notifyPrefsRoute` handles both GET and POST and falls through to `text("method not allowed", 405)`;
keep that shape so `server.ts` only tests the pathname, as it does today.

### 8. `bridge/snapshot-route.ts` — `/api/snapshot` and `/api/config`

The two "what is the bridge doing as a whole" reads. Both are inline today (lines 245–378 and
379–435). Lift each into a function taking an explicit deps object, because they close over a lot.

```ts
export interface SnapshotDeps {
  cfg: Config;
  registry: SessionRegistry;
  activity: ActivityLedger;
  snooze: Snooze;
  updateMonitor: UpdateMonitor;
  sssfViz: ReturnType<typeof createSssfViz>;
  workdir: ReturnType<typeof createWorkdir>;
  journals: JournalRegistry | null;
  transcripts: TranscriptStore | null;
  offerHistory: (agent: string, hasSessionRef: boolean) => boolean;
  sessionName: string | undefined;
}
export async function snapshotRoute(req: Request, deps: SnapshotDeps): Promise<Response>

export interface BridgeConfigDeps {
  cfg: Config;
  push: Push;
  operatorCommands: () => Promise<…>;
  operatorQuickReplies: () => Promise<…>;
  operatorKeys: () => Promise<…>;
}
export async function bridgeConfigRoute(req: Request, deps: BridgeConfigDeps): Promise<Response>
```

Use the exact return types the existing `createSssfViz` / `createWorkdir` / `createOperatorCommands`
factories give you (`ReturnType<typeof …>` is fine and avoids inventing names). The `unknownSession`
closure moves into `snapshotRoute` as a local — it is only two lines and only used here and by the
handlers in `server.ts`; **keep a copy in `server.ts` too** for the routes that stay there, or make
it a small exported helper in `responses.ts`. Prefer the latter:

```ts
// responses.ts
export function unknownSessionResponse(name: string | undefined, acceptEncoding: string | null) {
  return jsonError(`unknown session: ${name ?? ""}`, 404, acceptEncoding);
}
```

The 404 body string must stay byte-identical: `{"error":"unknown session: <name-or-empty>"}`.

Both bodies move verbatim, including the long comments about `withActivity` ordering, `decoratePanes`
keying on the *request's* session param, and why `/api/config` is read-level. Those are the load-
bearing notes.

Imports: `agentCwdKey`, `countPanesPerAgentCwd` from `./pane-read-routes.ts`; `withBuildHeader`,
`buildId`, `WEB_ROOT` from `./static-assets.ts`; `checkAccess`, `deviceAuth`, `guard` from
`./access.ts`; `json`, `text` from `./responses.ts`; `buildFreshness`, `toPaneWire`, `herdTagFor`,
`adapterFor`.

---

## What stays in `server.ts`

After the split, `server.ts` should be roughly 260–320 lines and contain only:

1. **Imports** from the eight new modules plus the existing bridge modules.
2. **`MAX_REQUEST_BODY_BYTES`** (line 53) — it is a `Bun.serve` option, so it belongs at the
   composition root.
3. **The route regexes** `PANE_ROUTE`, `TAB_ACTION_ROUTE`, `WORKSPACE_ACTION_ROUTE`
   (lines 119, 128, 131) with their comments — they are the dispatch table.
4. **`startServer`** — the factory calls (`createOperatorCommands`, `createOperatorQuickReplies`,
   `createOperatorKeys`, `buildJournalRegistry`, `new TranscriptStore()`, `offerHistory`,
   `createSssfViz`, `createWorkdir`), the `Bun.serve({…})` block with the `fetch` dispatch, the
   startup `console.log` lines, `startupWarnings` logging, and the `void buildFreshness(WEB_ROOT)`
   call.
5. **The re-export block** (see below).

The `fetch` body becomes a flat list of `if (pathname === …) return someRoute(…)`. Keep the section
comment banners (`// ── Live state …`, `// ── Structural creates …`, etc.) — they are how you
navigate the dispatch.

**Do not change the order of the checks in `fetch`.** The peer gate first, then `sssfViz.owns` /
`workdir.owns`, then the API routes in their current sequence, then `isReservedAuthPath`, then
`serveStatic`. Route matching is order-sensitive (`/api/tab` exact-POST before the
`/api/tab/:id/:action` regex).

## The `sssf-viz` / `workdir` injection stays exactly as it is

Both modules take a helpers object today specifically so they don't import `server.ts`. After the
split they *could* import the leaf modules directly — **don't do that.** `bridge/sssf-viz.ts` and
`bridge/workdir.ts` internals are out of scope; only their wiring moves. In `server.ts`:

```ts
const sssfViz = createSssfViz(cfg, {
  guard, isHostAllowed, requireJsonBody, failureText, resolveStaticPath, cacheControlFor, secure,
  csp: CSP, contentTypes: CONTENT_TYPES,
});
const workdir = createWorkdir(cfg, { guard, json, text, failureText, secure, contentTypes: CONTENT_TYPES });
```

— identical text, with the names now coming from imports instead of local definitions. The
`SssfHelpers` interface in `sssf-viz.ts` does not change.

## The re-export block — this is what keeps every existing import working

`server.ts` must still export all 30 public names. Add one block near the top (after the imports),
splitting values from types:

```ts
// ── Public surface ───────────────────────────────────────────────────────────
// server.ts is the composition root, but it stays the published address for the helpers the tests
// and sibling modules import. Moving a function to a route module must not move its import path.
export {
  SEEN_HEADER, marksPaneSeen, isLoopbackPeer, isStateChangingMethod,
  checkAccess, isHostAllowed, guard, deviceAuth, startupWarnings,
} from "./access.ts";
export { decodePathSegment, failureText, isJsonContentType, requireJsonBody } from "./responses.ts";
export {
  BUILD_HEADER, withBuildHeader, resolveStaticPath, isReservedAuthPath,
  cacheControlFor, isPrivateStaticFile,
} from "./static-assets.ts";
export { paneReadResponse, historyParams } from "./pane-read-routes.ts";
export { sendReplySteps, replyPane, keysPane } from "./pane-write-routes.ts";
export type { ReplySender, ReplyOutcome, SleepFn } from "./pane-write-routes.ts";
export { normalizeLabel } from "./tree-routes.ts";
export { parseNotifyPrefsPatch } from "./notify-routes.ts";
```

Check your list against the current one before you finish:

```bash
git show HEAD:bridge/server.ts | grep -n "^export " | sed 's/.*export \(async \)\?\(function\|const\|type\|interface\) \([A-Za-z_]*\).*/\3/' | sort > /tmp/before.txt
```

…and compare with the same extraction over the new `server.ts` (including the re-export block).
Every name in `before.txt` must still be exported. `startServer` is defined in `server.ts` and stays
a direct `export function`.

Three known importers must keep resolving unchanged:

- `bridge/index.ts:13` — `import { startServer } from "./server.ts"`
- `bridge/auth-path-contract.test.ts:3` — `import { isReservedAuthPath } from "./server.ts"`
- `bridge/sssf-viz.test.ts:8–16` — `cacheControlFor, checkAccess, deviceAuth, failureText,
  isHostAllowed, requireJsonBody, resolveStaticPath` from `"./server.ts"`

Leave all three files alone. If they compile and pass, the re-export block is right.

## Splitting `bridge/server.test.ts`

Optional but preferred — split it the same way as the code. **Test names must not change.** Every
`describe(...)` and `test(...)` string stays byte-identical, so the suite count stays 859.

Suggested split (the shared `req()` / `cfg()` helpers at the top get copied into each file, or
factored into a `bridge/test-helpers.ts` — copying is simpler and has no import-cycle risk):

| New test file | `describe` blocks moved (line numbers in current `server.test.ts`) |
|---|---|
| `bridge/access.test.ts` | 91, 155, 216, 330, 385, 398, 879, 927, 1003, 1088, 1203 |
| `bridge/responses.test.ts` | 432, 1266, 1291 |
| `bridge/static-assets.test.ts` | 448, 1134, 1160, 1185, 1237, 1254 |
| `bridge/pane-read-routes.test.ts` | 820, 842 |
| `bridge/pane-write-routes.test.ts` | 479, 536 |
| `bridge/tree-routes.test.ts` | 1111 |

That empties `server.test.ts` — delete it in that case. Each new test file imports from the module it
tests (`./access.ts`, `./responses.ts`, …), not from `./server.ts`.

If splitting the tests turns into a fight (shared fixtures, the big prompt-binding block at 536–818),
the acceptable fallback is: **leave `bridge/server.test.ts` exactly as it is.** It imports from
`./server.ts`, the re-exports resolve, and it passes unchanged. A green untouched test file is
stronger evidence of "no behaviour change" than a split one. Take the fallback rather than editing
assertions.

## Version bump — mandatory, part of the same change

PATCH: `0.55.1` → `0.55.2`. Three files must agree:

- `herdr-plugin.toml` line 3 — `version = "0.55.2"`
- `package.json` line 3 — `"version": "0.55.2"`
- `web/package.json` line 3 — `"version": "0.55.2"`

Then a `CHANGELOG.md` entry directly under the intro block, above `## [0.55.1]`:

```markdown
## [0.55.2] - 2026-08-22

### Changed
- `bridge/server.ts` split into route-group modules (`access`, `responses`, `static-assets`, `pane-read-routes`, `pane-write-routes`, `tree-routes`, `notify-routes`, `snapshot-route`); `server.ts` is now the composition root and re-exports the same names. Internal only — no route, response or header changed.
```

Use today's real date. One line, crisp, per the CHANGELOG style rule. Cite the commit hash at the end
of the line if you land the refactor as its own commit first and then cut the release commit.

Then:

```bash
bash scripts/check-version.sh    # must print ✓
```

## Docs to update in the same commit (doc-only, no extra bump)

`CLAUDE.md` §3 "Bridge — every module, one line" is a complete table of `bridge/`. It will be wrong
the moment you land this. Add one row per new file and rewrite the `server.ts` row. Suggested:

| File | Role |
|---|---|
| `server.ts` | Composition root. Builds the operator/journal/sssf/workdir helpers, then `Bun.serve` with the route dispatch. Re-exports the public helpers so their import path never moved. |
| `responses.ts` | How every response is built: `json`/`text`/`jsonError`/`secure`, the CSP + hardening headers, content types, JSON-body checks. |
| `access.ts` | The gate: `checkAccess` (host allowlist, same-origin, identity), `guard`, `deviceAuth`, `isLoopbackPeer`, the seen header, startup warnings. |
| `static-assets.ts` | Serves `web/dist` with CSP + cache rules, the build id and `X-Collie-Build`, the reserved `/auth` namespace. |
| `pane-read-routes.ts` | `GET /api/pane/:id` (ETag'd mirror read) and `/history` (journal paging). |
| `pane-write-routes.ts` | `reply` / `keys` / `upload` / `close` / `rename` — every route that types into or restructures a terminal, plus the prompt-binding check. |
| `tree-routes.ts` | Tab and space create / rename / close. |
| `notify-routes.ts` | `/api/subscribe`, snooze, notification prefs, `/api/update/check`. |
| `snapshot-route.ts` | `/api/snapshot` (the polled state) and `/api/config` (what the client is told about the bridge). |

Also update, in the same file:

- The §2 shape diagram — the `server.ts` box's sub-bullets should name the new modules.
- The §3 `/api/*` route table's "Handler" column: it says "(all in `server.ts`)" and names inline
  handlers. Retarget each row at its new module.
- §6 change-impact matrix: the "Auth / ingress / host & origin checks" row cites
  `bridge/server.ts (guard, checkAccess, isHostAllowed)` → `bridge/access.ts`.
- §7 fast-navigation table: the "Send didn't land" row cites `bridge/server.ts sendReplySteps` and
  `checkPromptBinding` → `bridge/pane-write-routes.ts`; "403 / host / origin / access" cites
  `bridge/server.ts guard` → `bridge/access.ts`; "Image upload" cites `server.ts uploadPane` →
  `bridge/pane-write-routes.ts`.

Then:

```bash
bash scripts/check-doc-links.sh
```

## Verify — all of these, in order

```bash
cd /c/claudeOS/Projects/tools/collie
bunx tsc --noEmit                 # clean
bun test ./bridge ./scripts       # 859 tests, 839 pass, 20 skip, 0 fail
bash scripts/check-version.sh     # ✓
bash scripts/check-doc-links.sh   # ✓
bun run test                      # the full backend gate (typecheck + bun test + ctl suite)
```

On Windows `bun run test` runs `bash scripts/collie-ctl.test.sh`, which refuses to run here by
design. That refusal is expected and is not a failure of this change — the pre-push hook runs
`contrib/windows/collie-ctl.test.ps1` instead. Judge the run by exit status; if the ctl script's
Windows guard makes `bun run test` non-zero on this box, the meaningful gates are the four commands
above it.

Then a smoke test that the bridge actually boots and serves:

```bash
# with the bridge running (contrib/windows/collie-ctl.ps1 restart), from the host:
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' -H 'Host: 127.0.0.1:8787' http://127.0.0.1:8787/api/config
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: 127.0.0.1:8787' http://127.0.0.1:8787/api/snapshot
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: 127.0.0.1:8787' http://127.0.0.1:8787/auth
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: 127.0.0.1:8787' http://127.0.0.1:8787/
```

Expect `200 application/json`, `200`, `404`, `200`. Bun does not hot-reload — restart the bridge
first or you are testing the old code, which is the #1 "my change didn't take" trap here.

## Git

Branch, don't commit to `main`:

```bash
git checkout -b refactor/split-server-routes
```

Land it as two commits if you can: the functional split first, then the `chore(release): 0.55.2`
commit with the version files + CHANGELOG (so the entry can cite the split's hash). Then
`gh pr create`. Do not tag — the user merges and tags.

If the pre-commit hook objects on the split commit because the version has not moved yet, that is the
hook working; either bump in the same commit or use `SKIP_VERSION_CHECK=1 git commit …` for the
first one and let the release commit satisfy it.

## Hard rules for this job

- **Move, don't rewrite.** Every function body, every comment, every doc block travels verbatim. If a
  diff line changes anything other than an import, a `function` → `export function`, or whitespace
  from re-indenting a lifted inline handler, justify it or revert it.
- **No new dependency.** Nothing gets added to `package.json`.
- **`web/` is out of scope** except the three comment-only file references named above. No rebuild
  needed, no `web/` test run needed.
- **Don't touch** `bridge/sssf-viz.ts`, `bridge/herdr-client.ts`, `bridge/push.ts` internals. Only the
  lines in `server.ts` that wire them move.
- **Don't rename a route, a header, an error string, or a status code.** If a test's expected string
  changes, you have broken behaviour.
- `noUnusedLocals` / `noUnusedParameters` are on. After moving code out, `server.ts` will have
  orphaned imports — `tsc --noEmit` will name every one. Let it drive the cleanup rather than
  guessing.

## If it goes wrong

The split is mechanical and each of the eight files is independent. If `tsc` or the tests go red and
the cause is not obvious, revert that one file's extraction (`git checkout -- bridge/<file>.ts` plus
restoring its block in `server.ts`) and land the other seven. A partial split that is green beats a
complete one that is not. Say in the PR description which group you left behind and why.
