# Plan — make `COLLIE_TRUSTED_USER` fail closed on a missing identity header (issue #2)

## What's wrong

`checkAccess()` in `bridge/server.ts` (~line 1170):

```ts
if (cfg.trustedUser) {
  const login = req.headers.get("tailscale-user-login");
  if (login && login !== cfg.trustedUser) {
    return { ok: false, reason: "identity not trusted" };
  }
}
```

An **absent** header passes. `tailscale serve` injects `Tailscale-User-*` only for requests from
**user** nodes — a **tagged** node (shared server, CI runner, ingress box) sends none. So with
`COLLIE_TRUSTED_USER` set, any tagged node on the tailnet reaches the bridge with full read **and**
write access, which is remote shell access to the herd.

`ARCHITECTURE.md` (~line 205) also claims the header is "trusted **only** when the request source is
loopback". Nothing reads `server.requestIP(req)` — the trust rests entirely on the loopback bind.
That sentence is wrong as written and must be corrected, not preserved.

### Why there is no loopback carve-out

Don't invent one. Two reasons:

- **The peer IP is always loopback.** `tailscale serve` proxies to `127.0.0.1:$COLLIE_PORT`, so a
  real tailnet client and a host-local `curl` both arrive from loopback. `requestIP` cannot tell
  them apart, so it buys nothing.
- **The `Host` header is client-controlled.** `tailscale serve` forwards the client's `Host`, so a
  `LOOPBACK_HOST.test(host)` exemption is spoofable by sending `Host: 127.0.0.1:8787` — it would be
  a hole, not a carve-out.

So: fail closed, and give the operator an explicit env opt-out for host-local/dev use.

## What "done" looks like

1. With `trustedUser` set and `skipServe` false, a request with **no** `Tailscale-User-Login` is
   rejected — `{ ok: false, reason: "identity required" }` — at **both** read and write level.
2. A **matching** login still passes; a **mismatching** login is still rejected
   (`"identity not trusted"`), and that mismatch check still runs under `skipServe` too.
3. Under `COLLIE_SKIP_SERVE=1` an absent header still passes (nothing injects it there; the
   existing startup warning already says the gate is inert).
4. New `COLLIE_TRUSTED_USER_OPTIONAL=1` restores the old tolerance, with a startup warning when set.
5. `bun test ./bridge/server.test.ts` and `bun test ./bridge/config.test.ts` are green.
6. README + ARCHITECTURE + `.env.example` describe the tagged-node gap and the new behaviour.

## Scope

- **In:** `bridge/server.ts`, `bridge/config.ts`, `bridge/server.test.ts`, `bridge/config.test.ts`,
  `README.md`, `ARCHITECTURE.md`, `.env.example`.
- **Out:** the other audit issues (#3–#12), the device gate (`COLLIE_DEVICE_HEADER`) — it already
  fails closed — the same-origin gate (issue #1, already landed), anything upstream, any frontend
  change, any new ADR.
- **Fork rule:** `origin` is `bartholomewtj/collie`, `upstream` is `AltanS/collie`. Per `CLAUDE.md`
  → *Versioning*, a fork PR **bumps nothing and adds no CHANGELOG entry**. Leave
  `herdr-plugin.toml`, both `package.json`s and `CHANGELOG.md` untouched. If the pre-commit hook
  objects: `SKIP_VERSION_CHECK=1 git commit …`.
- Branch `fix/2-trusted-user-fail-closed` already exists and is checked out. Stay on it.

---

## Change 1 — new config flag (`bridge/config.ts`)

### 1a. Rewrite the `trustedUser` jsdoc (~line 140)

It currently says an absent header "still passes … so this narrows *which* user is trusted rather
than mandating the header". That is now false. Replace with something like:

```
/**
 * Tailscale identity gate. If set, requests must carry a `Tailscale-User-Login` header (injected by
 * `tailscale serve`) matching this login. A mismatching login is rejected, and so is an ABSENT one
 * — `tailscale serve` injects no identity for TAGGED nodes, so tolerating an absent header handed
 * every tagged node on the tailnet full write access (issue #2). Under COLLIE_SKIP_SERVE=1 nothing
 * injects the header at all, so only the mismatch check applies there. Set
 * {@link trustedUserOptional} to restore the old tolerance for host-local callers.
 */
```

### 1b. Add the field, next to `trustedUser`

```ts
/**
 * Opt out of the fail-closed half of {@link trustedUser} (COLLIE_TRUSTED_USER_OPTIONAL=1): a
 * request with no `Tailscale-User-Login` passes again. For host-local callers that bypass
 * `tailscale serve` — `curl` on the host, `scripts/capture-fixture.sh`, the vite dev proxy. It
 * re-opens the tagged-node hole, so it is off by default and warned about at startup.
 */
trustedUserOptional: boolean;
```

### 1c. Parse it in `loadConfig()` (right after the `trustedUser` line, ~258)

```ts
trustedUserOptional: envBool("COLLIE_TRUSTED_USER_OPTIONAL", false),
```

`envBool` already exists in this file and is what `COLLIE_SKIP_SERVE` uses.

## Change 2 — the gate itself (`bridge/server.ts`, ~line 1170)

Replace the identity block:

```ts
  if (cfg.trustedUser) {
    const login = req.headers.get("tailscale-user-login");
    if (login) {
      if (login !== cfg.trustedUser) return { ok: false, reason: "identity not trusted" };
    } else if (!cfg.skipServe && !cfg.trustedUserOptional) {
      // Fail closed: `tailscale serve` injects no Tailscale-User-* for TAGGED nodes, so an absent
      // header is not "a loopback caller" — it is any tagged node on the tailnet (issue #2). There
      // is no safe loopback exemption here: serve proxies from 127.0.0.1 so the peer IP is always
      // loopback, and the Host header is the client's to set.
      return { ok: false, reason: "identity required" };
    }
  }
```

Two properties to preserve exactly:

- The **mismatch** rejection stays unconditional — a Variant C/E ingress may inject the header
  itself (README says it "still composes on top"), and that check must keep biting.
- The **presence** requirement is skipped under `skipServe`, because nothing injects the header
  behind a reverse proxy; requiring it there would 403 every request in Variants C/D/E.

Then update the `checkAccess` doc comment (~line 1137), replacing the "Optional Tailscale identity"
bullet with:

```
 *  - Optional Tailscale identity: when a trusted user is configured under `tailscale serve`, the
 *    request must carry a matching `Tailscale-User-Login`. A missing header is rejected too —
 *    serve injects none for tagged nodes, so tolerating it let any tagged node write. Under
 *    COLLIE_SKIP_SERVE=1 (no injector) or COLLIE_TRUSTED_USER_OPTIONAL=1, only a mismatch is
 *    rejected.
```

This applies at **read** level as well as write — deliberately. A tagged node reading pane output
and transcripts is the same disclosure the gate exists to stop, and unlike the device gate (which
degrades to read-only) there is no proxy contract here to make a read-only tier meaningful.

## Change 3 — startup warning (`bridge/server.ts`, `startupWarnings`, ~line 419)

Inside the existing `else if`/`if` structure for the non-`skipServe` branch, add the opt-out nag.
Target shape:

```ts
  if (cfg.skipServe) {
    if (cfg.trustedUser) { /* existing "has no effect" warning — unchanged */ }
  } else if (!cfg.trustedUser) {
    /* existing "is empty" warning — unchanged */
  } else if (cfg.trustedUserOptional) {
    warnings.push(
      `[bridge] WARNING: COLLIE_TRUSTED_USER_OPTIONAL=1 — a request with no Tailscale-User-Login is accepted, so any TAGGED tailnet node (which serve injects no identity for) gets full write access. Unset it outside host-local development.`,
    );
  }
```

Keep the existing three branches byte-identical; only the new `else if` is added. The four tests at
`bridge/server.test.ts:822-845` must still pass unchanged.

## Change 4 — tests

### 4a. `bridge/server.test.ts`

- Add `trustedUserOptional: false,` to the `cfg()` fixture (~line 57, next to `trustedUser`).
  Config is a required-field type, so this is needed for the file to typecheck.
- **Replace** the test at lines 158-161 ("a missing header still passes (documented loopback
  tolerance)"). It asserts the bug. New tests in the same `describe("checkAccess — Tailscale
  identity gate")` block:

```ts
  test("with a trusted user set, a MISSING header is rejected (issue #2 — tagged nodes)", () => {
    const c = cfg({ trustedUser: "me@example.com" });
    expect(checkAccess(req({ host: "h" }), c)).toEqual({
      ok: false,
      reason: "identity required",
    });
    // Writes too — and reads, above: a tagged node must not read pane output either.
    expect(checkAccess(req({ host: "h", origin: "http://h" }), c, "write")).toEqual({
      ok: false,
      reason: "identity required",
    });
  });

  test("a loopback Host does not exempt a missing header (Host is the client's to set)", () => {
    const c = cfg({ trustedUser: "me@example.com" });
    expect(checkAccess(req({ host: "127.0.0.1:8787" }), c)).toEqual({
      ok: false,
      reason: "identity required",
    });
  });

  test("under skipServe a missing header still passes (nothing injects one there)", () => {
    const c = cfg({ trustedUser: "me@example.com", skipServe: true });
    expect(checkAccess(req({ host: "h" }), c)).toEqual({ ok: true });
    // …but an ingress that DOES inject a mismatching login is still rejected.
    expect(
      checkAccess(req({ host: "h", "tailscale-user-login": "intruder@example.com" }), c),
    ).toEqual({ ok: false, reason: "identity not trusted" });
  });

  test("COLLIE_TRUSTED_USER_OPTIONAL restores the old tolerance", () => {
    const c = cfg({ trustedUser: "me@example.com", trustedUserOptional: true });
    expect(checkAccess(req({ host: "h" }), c)).toEqual({ ok: true });
    expect(
      checkAccess(req({ host: "h", "tailscale-user-login": "intruder@example.com" }), c),
    ).toEqual({ ok: false, reason: "identity not trusted" });
  });
```

The `req()` helper only fakes `headers.get`, so header names are free-form — that's why
`"tailscale-user-login"` is passed as a quoted key.

- The two existing tests either side (`"with no trusted user, any identity (or none) passes"`,
  `"with a trusted user set, a matching login passes"`, `"…a mismatching login is rejected"`) stay
  as they are and must keep passing.
- Add one warning test in the `startupWarnings` describe (~line 820):

```ts
  test("trustedUserOptional: warns the identity gate accepts an absent header", () => {
    const ws = startupWarnings(cfg({ trustedUser: "me@example.com", trustedUserOptional: true }));
    expect(has(ws, "COLLIE_TRUSTED_USER_OPTIONAL")).toBe(true);
  });
```

Check how `has()` is defined in that block and match it.

### 4b. `bridge/config.test.ts`

- Add `"COLLIE_TRUSTED_USER_OPTIONAL"` to the `KEYS` array (~line 28, next to
  `"COLLIE_TRUSTED_USER"`). Missing it means a developer's shell leaks into the suite.
- Add a default assertion alongside the other defaults (the block around line 78):
  `expect(cfg.trustedUserOptional).toBe(false);`
- Add a boolean-parse test modelled on the `COLLIE_SKIP_SERVE` one at lines 110-125 (on/off values,
  garbage → false, empty → false).

### 4c. Sweep for other fixtures

`grep -rn "trustedUser" bridge/ web/` before finishing. At plan time only `bridge/server.test.ts:57`
builds a full `Config` literal, so that should be the only fixture needing the new field — but a
`tsc` error is the real oracle, so run the typecheck (below).

## Change 5 — docs

Keep each edit to a few lines, plain language.

1. **`ARCHITECTURE.md` ~lines 205-212.** The paragraph starting "Under `tailscale serve`, the
   `Tailscale-User-Login` header is the person gate — trusted **only** when the request source is
   loopback…". Two corrections: (a) nothing reads the peer IP — the header is trusted because the
   bridge binds loopback and only the front door can reach it; (b) `COLLIE_TRUSTED_USER` now rejects
   a *mismatching* login **and an absent one**, because serve injects no identity for tagged nodes.
   Mention `COLLIE_TRUSTED_USER_OPTIONAL` as the explicit opt-out and that it re-opens that hole.
   Leave the surrounding device-gate discussion alone.
2. **`README.md` ~line 126**, the "Optional identity gate" bullet. It currently says the gate
   "passes an absent one". Rewrite: it rejects a mismatching login *and* a missing one, because
   `tailscale serve` injects no `Tailscale-User-*` for **tagged** nodes — so without this a tagged
   node (shared server, CI runner) had full write access. Note the loopback consequence: a `curl`
   on the host bypasses serve and so has no header either — set
   `COLLIE_TRUSTED_USER_OPTIONAL=1` for that, at the cost of re-opening the tagged-node gap.
3. **`README.md` Variant A (~line 507-520).** Add a short line under the existing bullets: the
   header is absent for tagged nodes and for anything reaching `127.0.0.1:$COLLIE_PORT` directly,
   and both are refused with `403 identity required`.
4. **`README.md` env table ~line 320.** Add a `COLLIE_TRUSTED_USER_OPTIONAL` row next to
   `COLLIE_TRUSTED_USER`, one line: "accept requests with no `Tailscale-User-Login` (host-local dev
   only — re-opens tagged-node access)".
5. **`.env.example` Security section (~line 64).** Under the `COLLIE_TRUSTED_USER` line:

```
# A request with NO Tailscale-User-Login is rejected too — `tailscale serve` injects no identity
# for TAGGED nodes, so accepting an absent header gave every tagged node on the tailnet write
# access. Host-local callers (curl on the box, scripts/capture-fixture.sh, `bun run web:dev`)
# bypass serve and have no header either; allow them back with the flag below, which also re-opens
# tagged-node access — dev only.
# COLLIE_TRUSTED_USER_OPTIONAL=1
```

Also fix the `COLLIE_SKIP_SERVE` note at ~line 18 if it needs it — it already says the identity
gate has no effect under skipServe, which stays true.

## Verify

Run from the repo root (`C:\claudeOS\Projects\collie`). **Judge every command by its exit status**,
not by scanning output for the word "error".

```bash
bun test ./bridge/server.test.ts    # must be green — the file you changed
bun test ./bridge/config.test.ts    # must be green
bun run typecheck                   # root tsc --noEmit — catches any missed Config fixture
bun test ./bridge                   # 39 PRE-EXISTING failures on Windows (POSIX paths)
```

`bun test ./bridge` is red before and after because of the Windows path failures. Capture the
failure count and file list on the current tree **before** editing, and confirm it is unchanged
after. Judge this change by the two files above being fully green.

Optional check against a running bridge with `COLLIE_TRUSTED_USER=you@example.com` set:

```bash
curl -i http://127.0.0.1:8787/api/snapshot                                  # expect 403 identity required
curl -i -H 'tailscale-user-login: you@example.com' http://127.0.0.1:8787/api/snapshot   # expect 200
```

## Commit / PR

- Stay on `fix/2-trusted-user-fail-closed`.
- One or two commits (gate + tests, then docs). Subject e.g.
  `Reject a missing Tailscale-User-Login when COLLIE_TRUSTED_USER is set`.
- No version bump, no CHANGELOG entry (fork rule). `SKIP_VERSION_CHECK=1 git commit …` if the
  pre-commit hook blocks; `SKIP_TESTS=1 git push` if the pre-push hook trips on the pre-existing
  Windows failures — say so in the PR body rather than skipping silently.
- `gh pr create` against `bartholomewtj/collie`. The PR body must state the breaking edge plainly:
  **anyone whose deployment relies on a header-less caller** (tagged node, host `curl`, vite dev
  proxy) now gets a 403 and needs `COLLIE_TRUSTED_USER_OPTIONAL=1`, or a user-node request.
