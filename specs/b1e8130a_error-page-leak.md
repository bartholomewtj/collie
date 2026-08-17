# Plan — Issue #10: stop the Bun dev error page and the path-leaking error bodies

Repo: `AltanS/collie` · Issue #10 (label `security`, severity Low) ·
Title: *decodeURIComponent before guard leaks Bun dev error page; error bodies echo paths*

## What's wrong

Two separate leaks, both in `bridge/server.ts`.

**1. An unhandled throw shows Bun's HTML dev error page.** `Bun.serve` is configured with no
`error()` callback and no `development` flag, and nothing anywhere in the repo sets
`NODE_ENV=production` (checked: zero hits across `.ts`, `.sh`, `.json`, the systemd unit, and
`collie-ctl.sh`). Bun's default is `development: process.env.NODE_ENV !== "production"`, so the
bridge runs in development mode on the deployment host. Any exception that escapes the `fetch`
handler returns an HTML page with a stack trace and absolute source paths.

The easiest trigger is `GET /api/pane/%ff` — `decodeURIComponent` throws `URIError` before anything
catches it. But the surface is wider than the two decode calls. Confirmed unguarded `await`s in the
`fetch` body that do filesystem writes and can throw `EACCES`/`ENOSPC` with an absolute path in the
message:

| Line (approx) | Call | Throws from |
|---|---|---|
| ~266 | `decodeURIComponent(tabMatch[1]!)` | `URIError` |
| ~276 | `decodeURIComponent(paneMatch[1]!)` | `URIError` |
| ~345 | `push.addSubscription(...)` | `push.ts` `mkdir`/`writeFile`/`rename` |
| ~369 | `snooze.set(until)` | `snooze.ts:63-70`, no catch |
| ~401 | `notifyPrefs.set(patch)` | `notify-prefs.ts:72-86` |
| ~1138 | `await file.arrayBuffer()` in `uploadPane` | sits *outside* that function's `try` |
| ~1542 | `file.exists()` in `serveStatic` | outside any try |

**2. Error response bodies echo `(err as Error).message` verbatim.** Around a dozen call sites. The
worst is `transcript read failed: ${err.message}` (~line 601), which wraps journal filesystem reads,
so an `ENOENT` puts an absolute log path on the wire. `herdr-client.ts` also rejects with raw socket
errors whose message embeds the absolute Herdr socket path.

Neither is an escalation — a caller already past the access gate has write access to a terminal —
but both are defeated defences, and the dev error page is reachable *before* `guard()` runs.

## Decisions made before you start

**Set `development: false` in code. Do NOT add `NODE_ENV=production` to the systemd unit.**
The issue suggests either. The env-var route needs five separate touch points to stay consistent
(`collie-ctl.sh` systemd unit, `collie-ctl.sh` launchd `_exec-bridge`, `collie-ctl.sh`
unsupervised `nohup`, the hand-maintained `systemd/collie.service` reference copy, plus
`bun run start` / `bun run dev`), none of which have test coverage — `collie-ctl.test.sh` asserts
nothing about the unit's contents, and nothing keeps the two unit copies in sync. A literal in
`bridge/server.ts` is one line inside the typechecked, tested surface and cannot drift. Losing the
dev error page during local development costs nothing here: the new `error()` handler logs the full
error object to the console anyway.

**No ADR.** This doesn't close off a decision someone will reasonably reopen. Put the "why not
NODE_ENV" reasoning in a comment at the `development: false` line — that matches how the repo
records this kind of thing elsewhere (`web/src/index.css`, `chrome.ts`).

**Generic error bodies are safe to ship — verified.** Frontend recon confirms:
- Bridge `error` strings land verbatim in `setStatus(...)` toasts (`composer.tsx:533`,
  `agent-chat.tsx:351`, `use-spaces.ts:37`, and ~12 more). They are user-facing copy.
- **Nothing branches on error string content.** Zero hits for `.includes(...)` / `startsWith` /
  `match(...)` against an error value anywhere in `web/src`. All branching is structural
  (`res.ok`, `res.code === "prompt_changed"`, `res.textDelivered`, HTTP status).
- **No test pins the bridge's wording.** Every frontend test that asserts error text supplies its
  own MSW fixture string and asserts pass-through.

So changing the message text cannot break behaviour. The detail moves to `journalctl --user -u
collie -f`, which is already the documented debugging path.

**One string you must not touch:** `sendReplySteps`'s partial-failure copy at ~line 654,
`"typed into the pane but not submitted — check the pane before resending"`. That is deliberate
operator instruction, not an exception message. It is asserted by `bridge/server.test.ts:407` and
mirrored by the client at `web/src/lib/reply-action.ts:439`. Leave it exactly as it is. Only the
sibling line below it (`error: (err as Error).message`) changes.

**Out of scope:** adding stable machine-readable `code` fields to every error response. That's a
real improvement but it's a new capability (a MINOR bump) and a bigger diff. Note it in the PR
description as a follow-up, don't build it.

## The work

### Step 1 — Add two helpers to `bridge/server.ts`

Both pure or near-pure and **exported**, following the file's existing convention (`isLoopbackPeer`,
`normalizeTabLabel`, `startupWarnings` are all exported purely so `server.test.ts` can reach them
without standing up `Bun.serve`). Put them near the other helpers at the bottom of the file, beside
`text()` / `json()` (~line 1344+).

```ts
/**
 * Decode one path segment, or null if the client sent a malformed percent-escape.
 *
 * `decodeURIComponent` throws `URIError` on input like `%ff` or `%E0%A4%A`. Every such throw used to
 * escape the fetch handler. Pure + exported so the malformed-input table is unit-tested without
 * standing up Bun.serve.
 */
export function decodePathSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * The single place an exception becomes a client-visible string.
 *
 * The real error — which routinely carries absolute journal, state-dir and Herdr-socket paths, and
 * for a socket failure the whole raw reply line — goes to the log, where the operator reads it with
 * `journalctl --user -u collie -f`. The client gets a fixed phrase naming only what was being
 * attempted. Never interpolate `err` into the return value.
 */
export function failureText(context: string, err: unknown): string {
  console.error(`[bridge] ${context} failed:`, err);
  return `${context} failed`;
}
```

`console.error` with a `[bridge]` prefix matches house style (`index.ts:44`, `state-engine.ts:346`,
`audit.ts:311`). Passing `err` as a second argument rather than interpolating `.message` gets the
full stack into the log, which is the point of the trade.

### Step 2 — Guard the two `decodeURIComponent` calls, and fix the ordering

**Tab route (~line 266).** `guard()` already runs first here (~262). Just make the decode safe:

```ts
const tabId = decodePathSegment(tabMatch[1]!);
if (tabId === null) return text("bad tab id", 400);
```

**Pane route (~line 274-283).** Here the decode genuinely runs *before* `guard()` — the issue's
literal complaint. Reorder so the access gate goes first. `isRead` is derived from `paneMatch[2]`,
not from the decode, so nothing blocks the move:

```ts
const paneMatch = pathname.match(PANE_ROUTE);
if (paneMatch) {
  const action = paneMatch[2];
  const isRead = !action || action === "history";
  const denied = guard(req, cfg, isRead ? "read" : "write");
  if (denied) return denied;
  const paneId = decodePathSegment(paneMatch[1]!);
  if (paneId === null) return text("bad pane id", 400);
  const rt = registry.get(sessionName);
  ...
```

Keep the long existing comments about `marksPaneSeen` and the `routed` check attached to the lines
they explain — they carry real reasoning, don't drop them while shuffling.

A 400 body of `"bad pane id"` leaks nothing: it says the URL was malformed, not whether any pane
exists.

### Step 3 — Close the `Bun.serve` catch-all

In the options object at ~line 176, alongside `hostname` / `port` / `maxRequestBodySize`:

```ts
// Bun's `development` default is `NODE_ENV !== "production"`, and nothing in Collie's launch paths
// sets NODE_ENV — so without this the bridge served Bun's HTML error page, stack trace and absolute
// source paths included, to anyone who could make a handler throw. Pinned in code rather than via a
// unit Environment= line because the three launch paths in collie-ctl.sh plus the hand-maintained
// systemd/collie.service copy would all have to agree, and nothing tests that they do.
development: false,

// Last line of defence: anything that escapes `fetch` (or a rejected promise a handler returned)
// lands here instead of Bun's default page. `text()` applies the shared hardening headers, which a
// raw `new Response` here would skip.
error(err: unknown) {
  return text(failureText("request", err), 500);
},
```

That yields a plain `500 request failed` with `nosniff` + `no-referrer` set, and the full stack in
the journal.

Check the `error()` signature typechecks against Bun 1.3.14 (`bun run typecheck` at the root will
tell you). If the installed types insist on `error(this: Server, request: Request, error: Error)`,
adapt the parameters — but keep logging only the error, not the request, so a URL with a token in a
query string never reaches the log.

### Step 4 — Route every client-visible `err.message` through `failureText`

Find them all rather than trusting these line numbers, which will shift as you edit:

```bash
grep -n "as Error).message" bridge/server.ts
```

Expect roughly a dozen. The rewrite is mechanical:

| Site | Before | After |
|---|---|---|
| `readPane` catch | `text(\`herdr read failed: ${(err as Error).message}\`, 502)` | `text(failureText("herdr read", err), 502)` |
| `paneHistory` catch | `text(\`transcript read failed: ${(err as Error).message}\`, 502)` | `text(failureText("transcript read", err), 502)` |
| `sendReplySteps` catch, 2nd return | `error: (err as Error).message` | `error: failureText("reply", err)` |
| `checkPromptBinding` catch | `error: \`herdr read failed: ${...}\`` | `error: failureText("herdr read", err)` |
| `keysPane` catch | `error: (err as Error).message` | `error: failureText("key send", err)` |
| `closePane` / `renamePane` catches | `error: (err as Error).message` | `failureText("close pane" / "rename pane", err)` |
| `closeTab` / `renameTab` catches | `error: (err as Error).message` | `failureText("close tab" / "rename tab", err)` |
| `createTab` / `createWorkspace` catches | `error: (err as Error).message` | `failureText("create tab" / "create space", err)` |
| `uploadPane` catch | `error: (err as Error).message` | `failureText("upload", err)` |

Pick a context phrase that reads correctly with `" failed"` appended, since that is what the
operator sees in the toast — `"upload failed"`, `"rename pane failed"`, `"herdr read failed"`. The
two 502 texts keep their exact existing wording minus the colon and detail, so nothing reads
strangely.

Two things to leave alone while you're in these catch blocks:
- The partial-failure sentence in `sendReplySteps` (Step 0 above).
- `audit.record(...)` calls inside catch blocks — the audit trail is server-side and should keep
  whatever detail it has.

Also confirm you have not changed the *shape* of any response: `ok`, `code`, `textDelivered`,
`status` all stay as they are. Only the `error` string's contents change.

### Step 5 — Move `uploadPane`'s body read inside its `try`

In `uploadPane` (~line 1138):

```ts
const bytes = new Uint8Array(await file.arrayBuffer());
```

sits above the `try` that starts ~1148. An aborted request body or an OOM here throws straight past
the handler. Move that line (and anything else between the `file` checks and the `try`) inside the
`try` block so it lands in the existing catch. Small, keeps `error()` as a genuine last resort
rather than a routine path.

### Step 6 — Tests

Add to `bridge/server.test.ts` (it already builds its own `Request` stubs and a `Config` factory; no
server needed):

```ts
describe("decodePathSegment", () => {
  // valid plain segment round-trips
  // "%20" -> " ", "w1%3Ap1" -> "w1:p1"
  // "%ff", "%E0%A4%A", "%" all return null
  // a segment that decodes to "" returns "" (not null) — falsy but valid, so assert `=== null`
  //   at the call sites, which the Step 2 code does
});

describe("failureText", () => {
  // returns exactly "<context> failed"
  // the returned string does NOT contain the error's message —
  //   drive it with `new Error("/home/op/.local/state/collie/push-subscriptions.json: EACCES")`
  //   and assert the return value has no "/home" and no "EACCES" in it
  // the real error IS logged: monkeypatch console.error, capture the args, restore in a finally
});
```

The path-absence assertion is the one that actually guards the regression — a future refactor that
reintroduces interpolation fails it.

You cannot unit-test `development: false` or the `error()` callback — they need `Bun.serve`, which
CLAUDE.md explicitly puts outside the unit suite. Cover them by hand in Step 7.

**Windows note:** `bun test ./bridge` currently reports ~547 pass / 39 fail on Windows, all from
POSIX path assumptions in pre-existing journal tests (recorded in `NEXT-SESSION.md`). Those are not
your regressions. Confirm your new tests pass and that the failure count does not increase.

### Step 7 — Manual verification on a real host

Backend changes need a restart — `systemctl --user restart collie`, or `herdr plugin action invoke
restart --plugin herdr.collie`. Bun does not hot-reload the bridge; forgetting this is the standard
"my change didn't take" trap.

```bash
# 1. Malformed escape -> plain 400, not HTML
curl -is 'http://127.0.0.1:8787/api/pane/%ff' | head -20
#    expect: HTTP/1.1 400, body "bad pane id", content-type NOT text/html

# 2. Same for the tab route
curl -is -X POST 'http://127.0.0.1:8787/api/tab/%ff/close' | head -20

# 3. No stack traces or absolute paths in any error body
curl -s 'http://127.0.0.1:8787/api/pane/nonexistent-pane-id' | grep -Ei 'at |/home/|\.ts:[0-9]' && echo LEAK || echo clean

# 4. The detail still reaches the operator
journalctl --user -u collie -n 50 | grep '\[bridge\]'
```

For the `error()` catch-all, force a throw once (temporarily `throw new Error("/tmp/secret-path")`
at the top of `fetch`, rebuild, hit any URL) and confirm the response is `500 request failed` with
no HTML, and that the journal has the full stack. **Revert that line before committing.**

### Step 8 — Version bump (MANDATORY)

This touches `bridge/`, so it is a functional change.

**PATCH: `0.29.0` → `0.29.1`.** The code now does what it was always meant to do — no new
capability, nothing the operator must reconfigure. The visible change (terser error toasts) does not
promote it; say so loudly in the CHANGELOG entry instead.

Bump all three, they must agree:
- `herdr-plugin.toml` line 3
- `package.json` line 3
- `web/package.json` line 3

Add to `CHANGELOG.md` under a new `## [0.29.1] - <today's real date>` heading. One line per change,
crisp, each citing the short commit hash of the functional commit. Land the functional commits
first, then cut the release commit so the hashes exist:

```markdown
## [0.29.1] - YYYY-MM-DD

### Fixed
- Malformed percent-escapes in a pane or tab URL now return 400 instead of Bun's HTML dev error page (abc1234).
- `Bun.serve` runs with `development: false` and an `error()` catch-all, so no stack trace or source path can reach a client (abc1234).
- Error responses name what failed and nothing else; the full error, with paths, now goes only to the log — read it with `journalctl --user -u collie -f` (abc1234).
```

Then run `scripts/check-version.sh` — it must print `✓`.

### Step 9 — Ship it

```bash
bun run typecheck          # root + web, strict, noUnusedLocals
bun run test               # bridge suite + scripts/collie-ctl.test.sh
bash scripts/check-version.sh
```

Branch → commit → push → `gh pr create`. Do not merge; the operator reviews the diff.

The pre-push hook runs typecheck and both test suites. If it objects, fix the cause rather than
using `SKIP_TESTS=1`.

Since this is a release commit on `main`, push the matching annotated tag with it:
`git tag -a v0.29.1 -m "Collie 0.29.1" && git push --follow-tags`. Do this only after the PR merges.

Suggested PR description points:
- What leaked and how it was reachable.
- Why `development: false` in code beat `NODE_ENV=production` in the unit.
- Behaviour change for the operator: error toasts are now generic; detail is in `journalctl`.
- Follow-up not done here: stable machine-readable `code` fields on error responses.

## Files you will touch

| File | Change |
|---|---|
| `bridge/server.ts` | Two new exported helpers; `development: false` + `error()` on `Bun.serve`; guarded decodes with reordered pane guard; ~12 catch blocks routed through `failureText`; `uploadPane` body read moved inside its `try` |
| `bridge/server.test.ts` | New `describe` blocks for `decodePathSegment` and `failureText` |
| `herdr-plugin.toml`, `package.json`, `web/package.json` | `0.29.0` → `0.29.1` |
| `CHANGELOG.md` | New `## [0.29.1]` entry |

No frontend source changes. No shell script changes. No systemd unit changes.

## Definition of done

- [ ] `GET /api/pane/%ff` returns `400` with a plain-text body, no HTML, no stack trace.
- [ ] `POST /api/tab/%ff/close` does the same.
- [ ] `guard()` runs before `decodeURIComponent` on the pane route.
- [ ] `Bun.serve` has both `development: false` and an `error()` handler returning through `text()`.
- [ ] No `grep -n "as Error).message" bridge/server.ts` hit sits inside a value returned to a client.
- [ ] The `"typed into the pane but not submitted"` sentence is byte-identical to before.
- [ ] New tests assert `failureText` never returns the input error's text.
- [ ] `bun run typecheck` clean; `bun run test` no new failures; `scripts/check-version.sh` prints `✓`.
- [ ] Version at `0.29.1` in all three files with a matching CHANGELOG entry.
