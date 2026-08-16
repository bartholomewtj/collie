# Plan — close the loopback-Origin bypass in the same-origin gate (issue #1)

## What's wrong

`checkAccess()` in `bridge/server.ts` accepts **any** request whose `Origin` header is a loopback
form, even when that Origin has nothing to do with the request's `Host`:

```ts
const allowed =
  originHost === host ||
  LOOPBACK_HOST.test(originHost) ||   // <-- the hole
  cfg.allowedOrigins.includes(origin);
```

So a page served from `http://localhost:<anything>` — a local dev server, another local app, a
malicious page a browser has been rebound onto — passes the CSRF gate against a remote Collie. The
bridge is remote shell access, so this is the whole gate for cross-site writes.

## What "done" looks like

1. `Origin: http://127.0.0.1:8787` + `Host: collie.example.ts.net` → `{ ok: false, reason: "cross-origin rejected" }`.
2. Same-origin (`originHost === host`) still passes; `COLLIE_ALLOWED_ORIGINS` still passes.
3. Every JSON-parsing POST route rejects a body whose `Content-Type` isn't `application/json` with
   **415**, so a cross-site form/`text/plain` POST can't be sent without a CORS preflight the
   bridge never answers.
4. `bun test ./bridge/server.test.ts` passes.

## Scope

- **In:** `bridge/server.ts`, `bridge/server.test.ts`, small doc touch-ups (`bridge/config.ts`
  jsdoc, `README.md`, `.env.example`).
- **Out:** audit issues #2–#12, anything upstream, the device gate, `COLLIE_TRUSTED_USER`, any
  frontend code change (the frontend already sends `content-type: application/json` — verified in
  `web/src/lib/api.ts:164` and `web/src/lib/push.ts:150`, so nothing there needs editing).
- **Fork rule:** `origin` is `bartholomewtj/collie`, `upstream` is `AltanS/collie`. Per
  `CLAUDE.md` → *Versioning*, a fork PR **does not bump the version and adds no CHANGELOG entry**.
  Leave `herdr-plugin.toml`, both `package.json`s and `CHANGELOG.md` untouched. If the pre-commit
  hook objects, commit once with `SKIP_VERSION_CHECK=1 git commit …`.
- Branch is already `fix/1-loopback-origin-csrf`. Stay on it.

---

## Change 1 — remove the Origin bypass (`bridge/server.ts`, ~line 1141)

In `checkAccess()`, drop the loopback clause:

```ts
const allowed = originHost === host || cfg.allowedOrigins.includes(origin);
if (!allowed) return { ok: false, reason: "cross-origin rejected" };
```

**Keep the `LOOPBACK_HOST` regex (line 91).** It is still used by two things that stay as they are:

- line ~1146 — a write with *no* Origin is trusted from a loopback **Host** (curl on the host);
- `isHostAllowed()` (~line 1167) — the `COLLIE_PUBLIC_HOSTS` allowlist.

Only the Origin-side use goes.

Update the doc comment above `checkAccess` (lines ~1111–1113). Replace
"localhost and explicitly-configured origins are also allowed" with something like:

```
 *  - Same-origin only: the Origin host must equal the Host header, or the exact Origin must be
 *    listed in COLLIE_ALLOWED_ORIGINS. A loopback Origin gets no special pass — a page on
 *    http://localhost:<any port> is a different origin from a remote Collie, and treating it as
 *    trusted handed any local page a CSRF write against the bridge.
```

Add a short line where the removed clause was, so nobody re-adds it:

```ts
// No loopback-Origin exemption: a page on http://localhost:NNNN is cross-origin to this bridge.
// Local dev through the vite proxy re-permits itself via COLLIE_ALLOWED_ORIGINS.
```

## Change 2 — require `application/json` on JSON routes (defence in depth)

A cross-site `fetch`/form POST can only set `Content-Type: text/plain`,
`application/x-www-form-urlencoded` or `multipart/form-data` without triggering a CORS preflight.
Requiring `application/json` therefore means any cross-site attempt must preflight — and the bridge
never sends CORS headers, so the browser blocks it before the request is made.

### 2a. Add a pure helper next to the other exported helpers in `server.ts`

```ts
/**
 * Whether a request body declares JSON. The gate on every JSON route: a cross-site POST can only
 * set text/plain, form-urlencoded or multipart without a CORS preflight, so demanding
 * application/json forces a preflight the bridge never answers. Pure + exported for tests.
 */
export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return value.split(";")[0].trim().toLowerCase() === "application/json";
}

/** 415 short-circuit for a JSON route, or null to proceed. */
export function requireJsonBody(req: Request): Response | null {
  if (isJsonContentType(req.headers.get("content-type"))) return null;
  return text("expected application/json", 415);
}
```

(`text()` already exists in the file and applies the security headers.)

### 2b. Call it at every site that does `req.json()`

Insert `const bad = requireJsonBody(req); if (bad) return bad;` immediately **before** the
`try { … await req.json() … }` block at each of these (line numbers are pre-edit, they will drift):

| line | route / function |
| --- | --- |
| ~310 | `POST /api/subscribe` |
| ~327 | `POST /api/notifications/snooze` |
| ~356 | `POST /api/notifications/prefs` |
| ~626 | `replyPane` |
| ~687 | `keysPane` |
| ~871 | `renamePane` |
| ~917 | `renameTab` |
| ~967 | `createTab` |
| ~1007 | `createWorkspace` |

`grep -n "req.json()" bridge/server.ts` gives the authoritative list — every hit gets the guard.

**Do not touch `uploadPane`** (~line 1050): it is `multipart/form-data` and already fails closed on
`req.formData()`.

In the handler functions (`replyPane`, `keysPane`, …) the guard goes at the top of the function
body, before any `herdr` call, so a rejected request never reaches the socket.

## Change 3 — tests (`bridge/server.test.ts`)

### 3a. Replace the test at lines 92–99

It currently asserts the bypass ("always allows a localhost / 127.0.0.1 origin"). Replace with:

```ts
test("rejects a loopback Origin that does not match the Host (issue #1)", () => {
  expect(
    checkAccess(req({ origin: "http://localhost:8787", host: "collie.example.ts.net" }), cfg()),
  ).toEqual({ ok: false, reason: "cross-origin rejected" });
  expect(checkAccess(req({ origin: "http://127.0.0.1:8787", host: "anything" }), cfg())).toEqual({
    ok: false,
    reason: "cross-origin rejected",
  });
  expect(
    checkAccess(req({ origin: "http://[::1]:8787", host: "collie.example.ts.net" }), cfg(), "write"),
  ).toEqual({ ok: false, reason: "cross-origin rejected" });
});

test("a loopback Origin still passes when it matches the Host (curl / host-local browser)", () => {
  expect(
    checkAccess(req({ origin: "http://127.0.0.1:8787", host: "127.0.0.1:8787" }), cfg(), "write"),
  ).toEqual({ ok: true });
});

test("a loopback dev origin passes only when COLLIE_ALLOWED_ORIGINS lists it", () => {
  const c = cfg({ allowedOrigins: ["http://localhost:5173"] });
  expect(
    checkAccess(req({ origin: "http://localhost:5173", host: "localhost:8787" }), c, "write"),
  ).toEqual({ ok: true });
});
```

No other existing test depends on the bypass — checked: the `Host-header validation`,
`Origin required for writes` and `isHostAllowed` blocks all use loopback **Host**, not Origin, and
they must keep passing unchanged.

### 3b. New tests for the content-type gate

Add `isJsonContentType` to the import list at the top, then a new describe block:

```ts
describe("isJsonContentType — JSON routes force a CORS preflight", () => {
  test("accepts application/json with or without parameters", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
    expect(isJsonContentType("Application/JSON")).toBe(true);
  });

  test("rejects the content types a cross-site POST can send without a preflight", () => {
    expect(isJsonContentType("text/plain")).toBe(false);
    expect(isJsonContentType("application/x-www-form-urlencoded")).toBe(false);
    expect(isJsonContentType("multipart/form-data; boundary=x")).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
    expect(isJsonContentType("")).toBe(false);
  });
});
```

### 3c. Route-level test that a `text/plain` POST is refused

The existing pane-action describe block (around line 355) already has a `request(body)` helper that
sets `content-type: application/json`, plus `FakePaneClient` and `auditEntries()`. Add a sibling
helper and two tests in that same block:

```ts
function textRequest(body: unknown): Request {
  return new Request("http://localhost/api/pane/w1%3Ap1/action", {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(body),
  });
}

test("a text/plain POST to a JSON route is refused before any socket call", async () => {
  const client = new FakePaneClient();
  const { audit } = auditEntries();
  const res = await replyPane(
    client as unknown as HerdrClient,
    cfg(),
    "w1:p1",
    textRequest({ text: "hello", submit: true }),
    audit,
    null,
    "default",
  );
  expect(res.status).toBe(415);
  expect(client.texts).toEqual([]);
  expect(client.keys).toEqual([]);
});

test("keys with a text/plain body is refused too", async () => {
  const client = new FakePaneClient();
  const { audit } = auditEntries();
  const res = await keysPane(
    client as unknown as HerdrClient,
    cfg(),
    "w1:p1",
    textRequest({ keys: ["Enter"] }),
    audit,
    null,
    "default",
  );
  expect(res.status).toBe(415);
  expect(client.keys).toEqual([]);
});
```

The existing JSON-bodied tests in that block already set `content-type: application/json`, so they
keep passing untouched.

## Change 4 — docs (small, no version bump)

The behaviour change bites exactly one real workflow: `bun run web:dev` proxies `/api` to the bridge
with `changeOrigin: true` (`web/vite.config.ts:176`), so the browser sends
`Origin: http://localhost:5173` against `Host: localhost:8787`. That used to slip through the
bypass; now it needs to be declared.

1. **`bridge/config.ts:161`** — the `allowedOrigins` jsdoc currently says "Extra allowed request
   origins beyond localhost". Rewrite: "Exact request origins allowed in addition to the request's
   own Host (e.g. your MagicDNS https origin, or `http://localhost:5173` for the vite dev proxy).
   There is no implicit loopback exemption."
2. **`.env.example`** — under the existing `COLLIE_ALLOWED_ORIGINS` block (~line 88–90) add:
   ```
   # Local frontend dev (`bun run web:dev`) is also a distinct origin — add it while developing:
   # COLLIE_ALLOWED_ORIGINS=http://localhost:5173
   ```
3. **`README.md`** — near the same-origin note at ~line 338–346, add one sentence: a loopback
   origin is not special-cased; if the browser's origin differs from the Host the bridge sees
   (including `http://localhost:5173` in dev), list it in `COLLIE_ALLOWED_ORIGINS`. Also add to the
   hand-driving note at ~line 543 that a `curl` POST must now send
   `-H 'content-type: application/json'`.

Keep the doc edits to a few lines each — plain language, no restating the threat model.

## Verify

Run from the repo root (`C:\claudeOS\Projects\collie`), judge each by **exit status**:

```bash
bun test ./bridge/server.test.ts     # must be green — this is the file you touched
bun run typecheck                    # root tsc --noEmit
bun test ./bridge                    # 39 pre-existing failures on Windows (POSIX paths) — expected
```

`bun test ./bridge` will be red before and after because of the pre-existing Windows path failures.
Before claiming done, confirm the failure count and file list is **unchanged** from the pre-edit run
(capture it first: `bun test ./bridge` on a clean tree, note the totals) and that
`bridge/server.test.ts` itself is fully green.

Optional sanity check against a running bridge on the host:

```bash
curl -i -X POST -H 'origin: http://127.0.0.1:9999' -H 'content-type: application/json' \
  -d '{"text":"x"}' http://127.0.0.1:8787/api/pane/w1%3Ap1/reply   # expect 403 cross-origin rejected
curl -i -X POST -H 'content-type: text/plain' -d '{}' \
  http://127.0.0.1:8787/api/notifications/snooze                    # expect 415
```

(The first one only demonstrates the gate if the Origin's port differs from the Host's.)

## Commit / PR

- Stay on `fix/1-loopback-origin-csrf`.
- One commit is fine; two is cleaner (gate fix, then content-type gate). Message subject e.g.
  `Remove the loopback-Origin bypass from the same-origin gate`.
- No version bump, no CHANGELOG entry (fork rule). `SKIP_VERSION_CHECK=1` if the pre-commit hook
  blocks. The pre-push hook runs both test suites — the pre-existing Windows failures mean you will
  likely need `SKIP_TESTS=1 git push`; say so in the PR description rather than silently skipping.
- Open the PR against `bartholomewtj/collie` with `gh pr create`. Body should state the behaviour
  change for the dev proxy (`COLLIE_ALLOWED_ORIGINS=http://localhost:5173`) so it isn't a surprise.
