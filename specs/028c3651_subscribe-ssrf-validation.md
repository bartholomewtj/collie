# Plan — Issue #7: `/api/subscribe` is a blind SSRF, no endpoint validation or caps

## Heads-up before you start

**The request file named in the task (`requests/issue-7-subscribe-ssrf.md`) does not exist.** This
plan was written from GitHub issue #7 itself (`gh issue view 7`), which is present and open. The
line numbers quoted in that issue are **stale** — the real ones are given below. Trust this plan's
line numbers, not the issue's.

## What's wrong

`POST /api/subscribe` (`bridge/server.ts:334-353`) is `guard(req, cfg, "read")`, and the only
validation is `isPushSubscription` (`bridge/server.ts:1363-1374`), which checks that `endpoint`,
`keys.p256dh` and `keys.auth` are strings. Nothing else.

`Push.broadcast` (`bridge/push.ts:297-364`) then POSTs to every stored endpoint on every agent
event. So any read-level client — every local uid, and under `COLLIE_DEVICE_HEADER` any
non-allowlisted device — can point the bridge at an arbitrary host and make it fire authenticated
HTTPS requests there whenever an agent flips state.

Four distinct holes:

1. **No scheme or host check.** `{"endpoint":"https://10.0.0.5:8443/admin/x", ...}` is accepted.
   Also accepts `http:`, `file:`, and anything else `new URL()` will parse.
2. **No key validation.** `p256dh: "p"` is stored happily (see `bridge/push.test.ts:26` — the
   tests themselves rely on this).
3. **No subscription cap.** Thousands of rows = a fan-out amplifier, and
   `push-subscriptions.json` is rewritten in full on every save (`push.ts:386-403`).
4. **No send timeout.** `SEND_OPTIONS` (`push.ts:94`) and `UPDATE_SEND_OPTIONS` (`push.ts:100`)
   pass no `timeout`, so a black-hole endpoint pins a socket. `broadcast` runs all sends under one
   `Promise.all`, so a hung endpoint stalls the whole round.

Endpoint length is bounded only by `MAX_REQUEST_BODY_BYTES` (12 MB, `server.ts:46`).

## Design decisions (settled — don't relitigate mid-build)

**Strict host allowlist, not a private-range denylist.** The issue offers both. Take the
allowlist. A denylist of private IP ranges only catches IP *literals* — a hostname that resolves to
`10.0.0.5` sails through, because DNS resolution happens at send time, not validation time. The set
of real web-push services is small and closed, so an allowlist actually closes the hole. Failure
mode of a wrong allowlist entry is a loud `400` plus a log line, and it's recoverable with one env
var; failure mode of a denylist is a silent open door.

Because the allowlist is strict, **a separate private-IP check on the endpoint is redundant** —
nothing private can match the allowlist anyway. Don't add one. (One private-looking-host check
does earn its keep, but only as a startup *warning* on operator-supplied env entries — see step 4.)

**Subscribe stays read-level.** The issue says "consider making subscribe write-level under the
device gate". Don't. A read-only device receiving notifications is a deliberate feature — the
comment at `server.ts:335-336` says so. Once the endpoint is validated, the SSRF is closed and
write-level buys nothing but a broken feature for read-only phones. Record this in an ADR (step 7)
so it isn't reproposed.

**At the cap, reject the new subscription — don't evict the oldest.** Evicting would let a flood
push out the operator's real phone, trading "no new devices" for "no push at all". Rejecting is the
safer failure mode; a household never approaches 20 devices.

## Files to touch

| File | Change |
|---|---|
| `bridge/push-endpoint.ts` | **new** — pure validation module |
| `bridge/push-endpoint.test.ts` | **new** — its tests |
| `bridge/config.ts` | new `pushAllowedHosts` config field |
| `bridge/server.ts` | replace `isPushSubscription`; handle the cap; startup warning |
| `bridge/push.ts` | cap in `addSubscription`; revalidate in `coerceStored`; `timeout` in send options |
| `bridge/push.test.ts` | fix fixtures (they use invalid keys today); cover the cap |
| `bridge/server.test.ts` | cover the new validator + startup warning |
| `README.md` | document `COLLIE_PUSH_ALLOWED_HOSTS` |
| `CHANGELOG.md`, `herdr-plugin.toml`, `package.json`, `web/package.json` | version bump |
| `.adr/0012-*.md` | the read-level decision |

No frontend change. `web/src/lib/push.ts:76-91` (`subscribeBody`) already sends exactly
`{endpoint, keys:{p256dh, auth}, replaces?}` from a real browser `PushSubscription`, which passes
every new check.

---

## Step 1 — New module `bridge/push-endpoint.ts`

Pure, no I/O, no Bun.serve dependency, so `bun test` can cover it fully. Export:

```ts
/** Longest endpoint we will store. Real push endpoints are ~150-400 chars; 2 KB is generous. */
export const PUSH_ENDPOINT_MAX = 2048;

/** Ceiling on stored subscriptions. A household has a handful of devices; this is a flood stop. */
export const MAX_SUBSCRIPTIONS = 20;

/** Hosts that operate a real Web Push service. Matched as an exact host OR a dot-suffix, so
 *  "notify.windows.com" covers "db5p.notify.windows.com". */
export const DEFAULT_PUSH_HOSTS: readonly string[] = [
  "fcm.googleapis.com",            // Chrome / Chromium, FCM
  "android.googleapis.com",        // legacy GCM-era Chrome endpoints
  "push.services.mozilla.com",     // Firefox (updates.push.services.mozilla.com)
  "push.apple.com",                // Safari / iOS (web.push.apple.com)
  "notify.windows.com",            // Edge / WNS (<region>.notify.windows.com)
  "push.services.microsoft.com",   // Edge, newer
];
```

### `hostAllowedForPush(host: string, extra: readonly string[]): boolean`

Lowercase `host`, then return true if any entry in `[...DEFAULT_PUSH_HOSTS, ...extra]` satisfies
`host === entry || host.endsWith("." + entry)`. Lowercase and trim each entry too. Ignore empty
entries.

### `looksPrivateHost(host: string): boolean`

Only used for the startup warning in step 4 — it is **not** part of endpoint validation. True for:
`localhost`; any host ending `.local`, `.internal`, `.home.arpa`; a single-label host (no `.`); and
IPv4/IPv6 literals in loopback / private / link-local / ULA / CGNAT ranges (`127.`, `10.`,
`192.168.`, `172.16-31.`, `169.254.`, `100.64-127.`, `::1`, `fc00::/7`, `fe80::/10`, `0.0.0.0`).
Strip `[` `]` from an IPv6 literal first.

### `validPushKey(value: string, bytes: number, exact: boolean): boolean`

Reject if `value` is empty or fails `/^[A-Za-z0-9_+\/-]+={0,2}$/` (accept both base64url and
standard base64 — browsers emit base64url unpadded, but be liberal on alphabet). Then decode with
`Buffer.from(value, "base64url").length` and compare: `exact ? len === bytes : len >= bytes`.

Node's `base64url` decoder tolerates `+`/`/`/`=`, so one decode path handles both alphabets.

### `validPushEndpoint(endpoint: string, extra: readonly string[]): boolean`

1. `typeof endpoint === "string"`, non-empty, `endpoint.length <= PUSH_ENDPOINT_MAX`.
2. Parse with `new URL(endpoint)` inside try/catch — a parse failure is a reject.
3. `url.protocol === "https:"`.
4. `url.username === "" && url.password === ""` (no credentials in the URL).
5. `hostAllowedForPush(url.hostname, extra)`.

Note `url.hostname` (not `url.host`) so a port doesn't defeat the suffix match. Don't restrict the
port — push services do use non-443 in some deployments and the host is already pinned.

### `parsePushSubscription(v: unknown, extra: readonly string[]): PushSubscription | null`

The replacement for `isPushSubscription`. Same object/string shape checks as today, plus:

- `validPushEndpoint(o.endpoint, extra)`
- `validPushKey(keys.p256dh, 65, true)` — web-push throws
  `"The subscription p256dh value should be 65 bytes long."` at
  `node_modules/web-push/src/encryption-helper.js:15` for anything else, so a bad value is a row
  that can never deliver.
- `validPushKey(keys.auth, 16, false)` — web-push requires **at least** 16 bytes
  (`encryption-helper.js:28`), not exactly 16. Browsers emit exactly 16; don't over-tighten.

Returns a **freshly built** `{ endpoint, keys: { p256dh, auth } }` — never the caller's object —
so no extra attacker-supplied field can ride along into storage or into `sendNotification`.

Import the `PushSubscription` type from `./push.ts`. (Type-only import; no cycle at runtime, and
`push.ts` will import values from `push-endpoint.ts` — keep the `push.ts` → `push-endpoint.ts`
direction one-way for values.)

## Step 2 — `bridge/config.ts`

Add to the `Config` interface, near `vapidPublic` (~line 318), with a doc comment in the file's
existing style explaining that it *extends* `DEFAULT_PUSH_HOSTS` for a self-hosted push service and
that entries are matched as exact-host-or-dot-suffix:

```ts
pushAllowedHosts: string[];
```

Populate it with the existing helper: `pushAllowedHosts: envList("COLLIE_PUSH_ALLOWED_HOSTS")`
(`envList` is at `config.ts:38`).

## Step 3 — `bridge/push.ts`

**a. Cap in `addSubscription` (line 224).** Change the return type to
`Promise<"ok" | "disabled" | "full">`:

- `if (!this.enabled) return "disabled";` (keep today's silent-success behaviour at the route).
- Keep the existing `meta.replaces` deletion block **before** the cap check — superseding frees a
  slot, which is the whole point of `replaces`.
- Then: `if (!this.subs.has(sub.endpoint) && this.subs.size >= MAX_SUBSCRIPTIONS)` → `console.warn`
  naming the cap and `collie push forget` as the remedy, and `return "full"`. A re-subscribe of an
  endpoint already stored is an update, not growth — it must still succeed at the cap.
- Everything else unchanged; `return "ok"` at the end.

**b. Revalidate on load.** `coerceStored` (line 55) currently accepts any string endpoint, so a
file poisoned before this fix (or hand-edited) survives a restart. Give it the allowed-hosts list
and drop rows failing `validPushEndpoint` / the key checks. Simplest wiring: give `coerceStored` a
second parameter `extra: readonly string[]` and pass `this.cfg.pushAllowedHosts` from `loadStore`
(line 373). Log once per dropped row (`[push] dropping invalid stored subscription: …`) — silent
data loss on load is worse than a log line. Also enforce `MAX_SUBSCRIPTIONS` in `loadStore`: stop
inserting past the cap and warn how many were skipped.

**c. Send timeout.** Add `timeout?: number` to the `SendOptions` type (line 140). Add
`timeout: 10_000` to both `SEND_OPTIONS` (line 94) and `UPDATE_SEND_OPTIONS` (line 100). web-push
3.6.7 supports it (`node_modules/web-push/src/web-push-lib.js:222-223, 317, 395-397` — it destroys
the socket with `Error("Socket timeout")`). Extend the block comment above `SEND_OPTIONS` with a
bullet explaining that the timeout is what stops a black-hole endpoint pinning a socket, since
`broadcast` awaits every send in one `Promise.all`.

A socket timeout surfaces as a non-404/410 error, so it feeds the existing `EVICT_AFTER` counter —
which is correct, and worth a sentence in the comment: a permanently black-holed endpoint gets
evicted after 5 same-origin-witnessed failures without any new machinery.

## Step 4 — `bridge/server.ts`

**a. Delete `isPushSubscription`** (lines 1361-1374). Import `parsePushSubscription` and
`looksPrivateHost` from `./push-endpoint.ts`.

**b. Rewrite the route body** (lines 347-352):

```ts
const parsed = parsePushSubscription(body, cfg.pushAllowedHosts);
if (parsed === null) return text("bad subscription", 400);
const result = await push.addSubscription(parsed, {
  replaces: supersededEndpoint(body),
  userAgent: req.headers.get("user-agent") ?? undefined,
});
if (result === "full") return text("too many subscriptions", 429);
return secure(new Response(null, { status: 204 }));
```

Keep the response body generic (`"bad subscription"`) — don't echo back *which* check failed; the
log line is where the detail belongs. Add a short comment above the call noting that a validated,
rebuilt subscription is what reaches storage, and pointing at issue #7.

Note `supersededEndpoint` (line 1384) still reads the *raw* body, which is right — it's a
housekeeping hint, already capped at 2048, and only ever used as a map key to delete.

**c. Startup warning** in `startupWarnings` (line 450), matching the existing style:

```ts
const risky = cfg.pushAllowedHosts.filter(looksPrivateHost);
if (risky.length) {
  warnings.push(
    `[bridge] WARNING: COLLIE_PUSH_ALLOWED_HOSTS contains private/loopback host(s) (${risky.join(", ")}) — any read-level client can now make the bridge POST to them (issue #7)`,
  );
}
```

## Step 5 — Tests

**`bridge/push-endpoint.test.ts` (new).** Cover, at minimum:

- Accepts a real-shaped FCM endpoint with valid 65-byte / 16-byte base64url keys.
- Accepts each default host family incl. a subdomain (`db5p.notify.windows.com`,
  `updates.push.services.mozilla.com`, `web.push.apple.com`).
- **Rejects the exploit from the issue verbatim**: `https://10.0.0.5:8443/admin/x`.
- Rejects `http://fcm.googleapis.com/...` (scheme).
- Rejects `https://evil.example.com/...` (host not allowlisted).
- Rejects `https://fcm.googleapis.com.evil.com/...` — this is the suffix-match trap; make sure the
  `"." + entry` form is what you implemented, not a bare `endsWith(entry)`.
- Rejects `https://user:pw@fcm.googleapis.com/...` (credentials).
- Rejects an endpoint over `PUSH_ENDPOINT_MAX`.
- Rejects `p256dh: "p"` and `auth: "a"` (today's fixtures), and a 64-byte p256dh.
- Accepts padded base64 and standard-alphabet keys.
- `parsePushSubscription` strips unknown fields — pass `{endpoint, keys, evil: 1}` and assert the
  returned object has exactly `endpoint` and `keys`.
- `hostAllowedForPush` honours an `extra` entry, and is case-insensitive.
- `looksPrivateHost` true for `localhost`, `10.0.0.5`, `192.168.1.1`, `172.20.0.1`, `169.254.1.1`,
  `[::1]`, `box.local`, `nodot`; false for `fcm.googleapis.com`.

**`bridge/push.test.ts` (edit).** The `sub()` helper at line 25 returns `{p256dh:"p", auth:"a"}`,
which the new `coerceStored` will now drop on load — **this will break existing tests if you skip
this step**. Replace it with valid fixture keys (generate once, hardcode as constants: a 65-byte
base64url string and a 16-byte one) and keep the per-endpoint variation. Then add:

- `addSubscription` returns `"full"` and stores nothing once `MAX_SUBSCRIPTIONS` rows exist.
- Re-subscribing an **already-stored** endpoint at the cap still returns `"ok"`.
- A `replaces` that frees a slot lets a new endpoint in at the cap.
- `loadStore` drops a row with a disallowed endpoint from a hand-written file.

**`bridge/server.test.ts` (edit).** Add `startupWarnings` coverage for a private
`pushAllowedHosts` entry (and no warning for a normal one). Note `parsePushSubscription` lives in
`push-endpoint.ts`, so its tests go in that file, not here.

## Step 6 — README

Add `COLLIE_PUSH_ALLOWED_HOSTS` alongside the other env vars. Explain in plain language: Collie
only accepts push endpoints on known push-service hosts (Chrome/Firefox/Safari/Edge all work out of
the box); set this comma-separated list only if you run a self-hosted push service; and setting it
to a private host lets any read-level client make the bridge POST there. The push section around
line 917 is the natural home, with a line in the env reference near the other `COLLIE_*` entries.

## Step 7 — ADR 0012

`.adr/0012-subscribe-stays-read-level.md`, following the format in `.adr/README.md`. Record: the
SSRF is closed by validating the endpoint, not by raising the access level; a read-only device
receiving notifications is intentional (`server.ts:335-336`); making subscribe write-level under
the device gate would silently stop notifications for exactly the devices most likely to be
read-only. Reference issue #7. Add a one-line normative pointer in `CLAUDE.md`'s security-posture
section linking to it — don't restate the reasoning there.

## Step 8 — Version bump (MANDATORY, see CLAUDE.md)

Current version is **0.29.0**. This adds a new setting (`COLLIE_PUSH_ALLOWED_HOSTS`) and a new
response condition, so by the CLAUDE.md axis this is **MINOR → 0.30.0**. Bump all three files to
`0.30.0`: `herdr-plugin.toml`, `package.json`, `web/package.json`.

Add a `## [0.30.0] - <today's real date>` heading to `CHANGELOG.md` — one crisp line per change,
Added / Changed / Fixed, each citing the short commit hash of the feature commit. Land the
functional commits first, then cut the release commit so the hashes exist.

Then run `scripts/check-version.sh` — it must print `✓`.

## How to verify

```bash
bun test ./bridge/push-endpoint.test.ts
bun test ./bridge/push.test.ts
bun test ./bridge/server.test.ts
bun run build          # typechecks root + web, then builds
scripts/check-version.sh
```

**Windows caveat:** ~39 pre-existing tests in the suite fail on Windows for POSIX-path reasons.
Judge by the tests you touched, not the whole-suite count. Confirm the same failures exist on
`main` before blaming your change.

Manual smoke, if a real device is to hand: subscribe from a phone and confirm a 204 and a working
push; then `curl` the exploit body and confirm a 400:

```bash
curl -si -X POST localhost:8787/api/subscribe \
  -H 'content-type: application/json' -H 'origin: http://localhost:8787' \
  -d '{"endpoint":"https://10.0.0.5:8443/admin/x","keys":{"p256dh":"p","auth":"a"}}'
```

(Add whatever `X-Requested-With` header `web/src/lib/push.ts:150` sends — the same-origin gate
wants it.)

## Done means

- `POST /api/subscribe` rejects with 400: non-`https`, a host outside the allowlist (including the
  `fcm.googleapis.com.evil.com` suffix trap), a private-IP endpoint, credentials in the URL, an
  over-2 KB endpoint, and malformed `p256dh`/`auth`.
- Stored subscriptions are capped at 20; the 21st distinct endpoint gets 429 and nothing is
  written; a re-subscribe or a `replaces` still works at the cap.
- Both send-option constants carry a `timeout`.
- `loadStore` drops rows that fail the same validation and logs each one.
- A private entry in `COLLIE_PUSH_ALLOWED_HOSTS` produces a startup warning.
- New and edited tests pass; `bun run build` and `scripts/check-version.sh` both succeed.
- ADR 0012 exists; README documents the new env var; version is 0.30.0 in all four places.

## Out of scope

The other audit issues (#1-#6, #8-#12). Any change to `checkAccess`, `guard`, the device gate, or
`COLLIE_TRUSTED_USER`. Any frontend change — `web/src/lib/push.ts` already sends a conforming body.
Rate-limiting `/api/subscribe` per client. Reporting anything upstream to Herdr. Rotating or
re-validating VAPID keys.
