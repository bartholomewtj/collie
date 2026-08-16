# Plan — Issue #4: refuse a non-loopback bind, and reject non-loopback peers

## The problem

`bridge/config.ts:236` takes `COLLIE_HOST` verbatim:

```ts
host: process.env.COLLIE_HOST ?? "127.0.0.1",
```

Nothing validates it. `bridge/server.ts:419` `startupWarnings()` only prints a warning when the host
isn't `127.0.0.1` or `localhost`, and the process starts anyway.

That matters because every other write gate in the bridge assumes the loopback bind:

- `Tailscale-User-Login` is trusted only because `tailscale serve` is the only thing that can reach
  the port. Bound wide, any client sets that header itself.
- `COLLIE_DEVICE_HEADER` has the same trust basis (`config.ts:159-160` says so out loud).
- The same-origin gate lets a request through when `Origin` host equals `Host`, and both are the
  client's to send. `Host: localhost:8787` with no `Origin` also passes the write path
  (`server.ts:1172`, because `LOOPBACK_HOST` matches the Host header).

So a wide bind turns three gates into no gates, and the peer address — the one value the client
can't forge — is never looked at.

Also cosmetic, from the issue: `startupWarnings` treats `::1` as non-loopback and warns about it,
which is wrong.

## What we're building

Two changes, in this order of importance:

1. **Primary gate — refuse to start.** A non-loopback `COLLIE_HOST` makes `loadConfig()` throw, and
   the bootstrap exits 1 with a readable message. An operator who genuinely wants a wide bind sets
   `COLLIE_ALLOW_NON_LOOPBACK_BIND=1` and says so deliberately.
2. **Defence in depth — check the peer.** The `fetch` handler rejects any request whose TCP peer
   address isn't loopback, before routing. Under a correct loopback bind this can never fire; it is
   insurance against a future bind path, a misconfigured override, or a container-level
   port-forward. It is disabled when the operator opted into the wide bind, so the override stays
   one switch rather than two.

Both predicates are pure and exported so `bun test` covers them (per `CLAUDE.md` — the bits that
need `Bun.serve` stay unit-untested, so keep the logic out of the handler body).

## Files to touch

| File | Change |
| --- | --- |
| `bridge/config.ts` | New `isLoopbackBindHost()`, new `allowNonLoopbackBind` config field, throw in `loadConfig()` |
| `bridge/index.ts` | Catch the config error at line 38 and exit 1 cleanly |
| `bridge/server.ts` | New `isLoopbackPeer()`, peer check at the top of `fetch`, fix `startupWarnings` |
| `bridge/config.test.ts` | Rewrite the `0.0.0.0` test; add predicate table tests; add env keys to the reset list |
| `bridge/server.test.ts` | Add the new field to the `cfg()` helper; add peer + warning tests |
| `README.md` | Document `COLLIE_ALLOW_NON_LOOPBACK_BIND` in the config block and security notes |
| `ARCHITECTURE.md` | Section 6: say the loopback bind is now enforced, not just documented |

Do **not** touch `herdr-plugin.toml`, `package.json`, `web/package.json` or `CHANGELOG.md` — see
*Versioning* at the bottom.

---

## Step 1 — `bridge/config.ts`

### 1a. Add the predicate

Put it near `defaultSocketPath()` (around line 212), exported so tests can hit it directly:

```ts
/**
 * Whether a bind host keeps the listener on loopback. Loopback is the trust basis for every write
 * gate in the bridge — the Tailscale identity header, the device header and the same-origin check
 * are all client-settable values that only mean anything because `tailscale serve` (or a local
 * reverse proxy) is the only thing that can reach the port. Bound wide, all three are decoration.
 *
 * Accepts every spelling of loopback, not just the two the old startup warning knew about: the
 * whole 127.0.0.0/8 block, `localhost`, and IPv6 `::1` in bare, bracketed and expanded form.
 * Rejects the wildcards (`0.0.0.0`, `::`), LAN addresses, and any hostname.
 *
 * Pure + exported so the table of accepted/rejected spellings is unit-tested.
 */
export function isLoopbackBindHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost") return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}
```

Strip surrounding brackets first so `[::1]` — the form that appears in a URL — is accepted. Empty
string falls through to the regex and returns `false`, which is what we want (an empty `COLLIE_HOST`
is a mistake, not a default).

### 1b. Add the config field

In the `Config` interface, right after `host` (line 106):

```ts
  /**
   * Escape hatch for {@link host}: permit a bind that is not loopback (`COLLIE_ALLOW_NON_LOOPBACK_BIND=1`).
   * Without it the bridge refuses to start on a wide bind rather than warning and carrying on — a
   * warning in a log nobody reads is not a control, and the bind is what every write gate rests on
   * (issue #4). Setting it also disables the peer-address check in server.ts, because a deliberate
   * wide bind means non-loopback peers are the point; one switch, not two.
   */
  allowNonLoopbackBind: boolean;
```

Update the `host` doc comment on line 102-105 to say it is now enforced, not merely defaulted:

```ts
  /**
   * Bind host. Loopback is REQUIRED, not merely the default — `loadConfig` refuses a non-loopback
   * value unless {@link allowNonLoopbackBind} is set, because binding wide makes the Tailscale
   * identity check, the device header and the same-origin gate all client-forgeable
   * (see ARCHITECTURE.md §6).
   */
```

### 1c. Validate in `loadConfig`

`loadConfig` builds one object literal, so hoist the two values into locals above the `return`,
alongside the existing `stateDir` / `submitKeys` locals:

```ts
export function loadConfig(): Config {
  const stateDir = /* unchanged */;
  const submitKeys = envList("COLLIE_SUBMIT_KEYS");

  const host = process.env.COLLIE_HOST ?? "127.0.0.1";
  const allowNonLoopbackBind = envBool("COLLIE_ALLOW_NON_LOOPBACK_BIND", false);
  // Fail at boot, not with a warning. A bridge bound off-loopback has no working write gate at all
  // (issue #4), so starting it is worse than not starting it — the operator sees a stopped service
  // and a one-line reason, instead of an open one and a line in journalctl.
  if (!isLoopbackBindHost(host) && !allowNonLoopbackBind) {
    throw new Error(
      `COLLIE_HOST=${host} is not a loopback address. Collie binds loopback only: the ` +
        `Tailscale-User-Login header, COLLIE_DEVICE_HEADER and the same-origin gate are all ` +
        `client-settable and mean nothing on a wide bind, so binding here would hand write access ` +
        `to anything that can reach the port. Use 127.0.0.1 (the default) and put your ingress in ` +
        `front of it — see README → Variants. If you truly mean to bind wide and have another ` +
        `control in front, set COLLIE_ALLOW_NON_LOOPBACK_BIND=1.`,
    );
  }

  return {
    // ...
    host,
    allowNonLoopbackBind,
    // ...
  };
}
```

Keep the field's position in the returned literal next to `host` so the shape reads in the same
order as the interface.

---

## Step 2 — `bridge/index.ts`

Line 38 is `const cfg = loadConfig();` at the top level of an ES module. An uncaught throw there
prints a stack trace, which buries the message. Wrap it:

```ts
// Entry point: resolve config, wire the pieces, start polling and serving.
// loadConfig throws on a config that would be unsafe to serve (a non-loopback bind). Print the
// reason alone — a stack trace here buries the one line the operator needs.
let cfg: Config;
try {
  cfg = loadConfig();
} catch (err) {
  console.error(`[bridge] FATAL: ${(err as Error).message}`);
  process.exit(1);
}
```

`Config` is already exported from `./config.ts`; add it to the existing import as a **type** import
(`import { loadConfig, type Config } from "./config.ts"`). Check what the current import on line 7
looks like and extend it rather than adding a second import line.

Note on TypeScript: `process.exit(1)` is typed `never` in Bun's types, so control flow analysis
should accept `cfg` as definitely-assigned after the try/catch. If `tsc` still complains that `cfg`
is used before assignment, the fix is to make the catch block end with `throw err` after the
`console.error`, or restructure as a small `resolveConfig()` helper that returns `Config`. Do
whichever typechecks; don't reach for a non-null assertion.

---

## Step 3 — `bridge/server.ts`

### 3a. Add the peer predicate

Next to `LOOPBACK_HOST` (line 91):

```ts
/**
 * Whether a TCP peer address is loopback. Unlike the `Host` header — which the client writes and
 * `LOOPBACK_HOST` above merely parses — this comes from the kernel and cannot be forged, so it is
 * the one honest answer to "is this caller on the box".
 *
 * Bun gives IPv4 peers as `127.0.0.1` and IPv6 peers as `::1`; a dual-stack listener can also report
 * an IPv4 peer in v4-mapped form (`::ffff:127.0.0.1`), so all three shapes are matched.
 *
 * A null/absent address is treated as loopback, i.e. this check abstains rather than rejecting.
 * `Server.requestIP` returns null for a request whose socket has already gone, and the bind gate in
 * config.ts is the primary control — this one is defence in depth. Failing closed on an
 * unknowable address would trade a real hole for a flaky one.
 *
 * Pure + exported so the address table is unit-tested without standing up Bun.serve.
 */
export function isLoopbackPeer(address: string | null | undefined): boolean {
  if (!address) return true;
  const a = address.trim().toLowerCase();
  if (a === "::1" || a === "0:0:0:0:0:0:0:1") return true;
  const v4 = a.startsWith("::ffff:") ? a.slice(7) : a;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}
```

### 3b. Wire it into `fetch`

The handler at line 165 is `async fetch(req) {`. Bun passes the server as the second argument. Add
it — name it `srv` so it doesn't shadow the `const server = Bun.serve(...)` being assigned on line
158 — and put the check first, before `new URL(req.url)`:

```ts
    async fetch(req, srv) {
      // Peer-address gate, ahead of routing so it covers the static PWA too. Under the loopback bind
      // that config.ts enforces this can never fire; it exists so a wide bind reached some other way
      // (a container port-forward, a future bind path, a hand-edited unit) still can't reach a route.
      // Skipped when the operator explicitly opted into a wide bind — there, remote peers are the point.
      if (!cfg.allowNonLoopbackBind && !isLoopbackPeer(srv.requestIP(req)?.address)) {
        return text("non-loopback peer rejected", 403);
      }

      const url = new URL(req.url);
      // ...unchanged from here
```

`text(...)` is the existing helper used at line 179; it's already in scope. `cfg` is destructured
from `opts` at line 145, also in scope.

If `noUnusedParameters` objects to anything here it won't — `srv` is used. But do confirm the Bun
type for the second parameter resolves; if `srv.requestIP` isn't typed on it, the handler signature
may need `async fetch(req: Request, srv: Server)` with `import type { Server } from "bun"`.

### 3c. Fix `startupWarnings`

Line 421 currently reads:

```ts
  if (cfg.host !== "127.0.0.1" && cfg.host !== "localhost") {
```

That's the `::1` bug from the issue. Replace with the shared predicate (import `isLoopbackBindHost`
from `./config.ts` alongside the existing `Config` type import), and reword — after step 1 the only
way to reach this line with a non-loopback host is via the override, so the warning should name it:

```ts
  if (!isLoopbackBindHost(cfg.host)) {
    warnings.push(
      `[bridge] WARNING: bound to ${cfg.host} via COLLIE_ALLOW_NON_LOOPBACK_BIND — the identity, device and same-origin gates are all client-settable on a wide bind, and the peer-address check is off. Whatever fronts this port is now the only control.`,
    );
  }
```

Update the JSDoc above `startupWarnings` (lines 410-418) if it describes the old host condition.

---

## Step 4 — Tests

Run with `bun test ./bridge` from the repo root.

### `bridge/config.test.ts`

- **Line 12** — the env-reset list already contains `"COLLIE_HOST"`. Add `"COLLIE_ALLOW_NON_LOOPBACK_BIND"`
  to it so a test that sets the override doesn't leak into the next one. Check how that list is
  consumed (it's a `beforeEach`-style delete loop) and follow the existing shape.
- **Lines 283-289** — the test `"honours an explicit trusted user and host override"` currently
  asserts `COLLIE_HOST=0.0.0.0` is accepted. That is exactly the bug. Split it into two:

```ts
  test("refuses a non-loopback COLLIE_HOST", () => {
    process.env.COLLIE_HOST = "0.0.0.0";
    expect(() => loadConfig()).toThrow(/not a loopback address/);
  });

  test("a non-loopback bind needs the explicit override", () => {
    process.env.COLLIE_HOST = "0.0.0.0";
    process.env.COLLIE_ALLOW_NON_LOOPBACK_BIND = "1";
    const cfg = loadConfig();
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.allowNonLoopbackBind).toBe(true);
  });
```

  Keep the `COLLIE_TRUSTED_USER` assertion that shared the old test — move it into whichever of the
  two reads naturally, or leave it as its own one-liner.

- **New** — table test for `isLoopbackBindHost`:
  - true: `127.0.0.1`, `127.0.0.2`, `127.1.2.3`, `localhost`, `LOCALHOST`, `::1`, `[::1]`,
    `0:0:0:0:0:0:0:1`
  - false: `0.0.0.0`, `::`, `192.168.1.10`, `10.0.0.1`, `collie.example.ts.net`, `""`

- **New** — the default is still loopback and needs no override:
  `expect(loadConfig().host).toBe("127.0.0.1")` and `allowNonLoopbackBind` is `false`.

### `bridge/server.test.ts`

- **The `cfg()` helper (lines 40-72)** — `Config` is a strict interface, so adding a required field
  breaks every test in the file until the helper supplies it. Add `allowNonLoopbackBind: false,`
  next to `host: "127.0.0.1",`. **Do this first**, or you'll be reading a wall of unrelated type
  errors.
- **New** — table test for `isLoopbackPeer`:
  - true: `127.0.0.1`, `127.5.5.5`, `::1`, `::ffff:127.0.0.1`, `0:0:0:0:0:0:0:1`, `null`, `undefined`, `""`
  - false: `192.168.1.10`, `100.64.0.1` (a tailnet address — the realistic attacker),
    `::ffff:192.168.1.10`, `10.0.0.1`
  - Add a comment on the `null` case saying it abstains deliberately, so a later reader doesn't
    "fix" it into a rejection.
- **`startupWarnings` describe block (line 853)** — add:
  - `cfg({ host: "::1" })` produces **no** bind warning (the cosmetic bug from the issue).
  - `cfg({ host: "0.0.0.0", allowNonLoopbackBind: true })` **does** produce one, and it mentions
    `COLLIE_ALLOW_NON_LOOPBACK_BIND`.
  Match the assertion style the neighbouring tests use (they inspect the returned `ws` array).

### Other test files

Grep for other constructions of a `Config` object in tests — `bridge/*.test.ts` and
`bridge/journal/` — and add `allowNonLoopbackBind: false` to any that build the full interface
rather than a partial. `grep -rn "publicHosts: \[\]" bridge/` finds them quickly, since every full
Config literal has that field.

---

## Step 5 — Docs

### `README.md`

- **Around line 320-325** (the "Configure" `.env` block) — this is where the security-relevant vars
  are listed. Don't add `COLLIE_ALLOW_NON_LOOPBACK_BIND` here; it isn't something anyone should turn
  on, and this block is the "close both warnings in one sitting" list.
- **Instead**, add a short note wherever `COLLIE_HOST=127.0.0.1 # keep loopback (default)` already
  appears (lines 576 and 777, in Variants C and E). Change the trailing comment on both to
  `# loopback is enforced; the bridge refuses to start otherwise` so the operator who wonders why
  their `0.0.0.0` doesn't take finds the answer next to the line they'd edit.
- Add one paragraph to whichever section covers the security posture (search for the text about the
  bridge binding loopback) naming the override, what it turns off (the peer check as well as the
  bind check), and that using it makes the operator's own ingress the only control.

### `ARCHITECTURE.md`

Section 6, near line 206 (`the bridge binds loopback and only the front door can reach it`). Add
that this is now **enforced**: a non-loopback `COLLIE_HOST` refuses to boot, and the request path
checks the TCP peer address as a second line. Keep it to two or three sentences — the reasoning
already lives in the code comments.

Leave line 223's `(loopback always allowed)` alone. That describes `isHostAllowed`'s treatment of
the Host header under `COLLIE_PUBLIC_HOSTS`, which is a separate mechanism and out of scope here.

### `.adr/`

Not required. This decision doesn't close off an option someone will keep re-proposing — the issue
and the code comments carry the reasoning. If you disagree once you're in the code, the shape worth
recording would be *"the peer check abstains on an unknown address"*, and the next free number is
`0011`.

---

## Verify

Judge each command by its **exit status**, not by scanning output for words like `error`.

```bash
bun test ./bridge          # backend unit tests
bunx tsc --noEmit          # or: bun run build (root) — typechecks both sides
```

`bun run build` at the root runs `scripts/check-version.sh` first; it must print `✓`. Since we're
not bumping (see below), all four version files keep `0.29.0` and it stays green.

**Known noise:** roughly 39 pre-existing tests fail on Windows for POSIX-path reasons. Judge by the
tests you touched, not the whole suite total. If a failure names a file you didn't touch and the
message is about a path shape, it's pre-existing — confirm with `git stash && bun test ./bridge`
before chasing it.

### Manual smoke (optional, needs a Unix host)

```bash
COLLIE_HOST=0.0.0.0 bun bridge/index.ts        # expect: one FATAL line, exit 1, no stack trace
COLLIE_HOST=0.0.0.0 COLLIE_ALLOW_NON_LOOPBACK_BIND=1 bun bridge/index.ts   # expect: starts, warns
bun bridge/index.ts                            # expect: unchanged behaviour
```

Backend changes need `systemctl --user restart collie` on the deployment host — Bun does not
hot-reload the service. Not needed for this task unless you're testing on the real box.

## Done means

- `COLLIE_HOST=0.0.0.0` (or any LAN address, or `::`) makes the bridge exit 1 with a one-line
  reason, no stack trace.
- `COLLIE_ALLOW_NON_LOOPBACK_BIND=1` re-permits it, and the startup warning names that variable.
- `COLLIE_HOST=::1` starts cleanly and produces **no** bind warning.
- A request whose TCP peer is not loopback gets a 403 before it reaches any route, unless the
  override is set.
- `isLoopbackBindHost` and `isLoopbackPeer` are exported and covered by table tests including the
  IPv4-mapped and null cases.
- `bun test ./bridge` and the typecheck both exit 0 (allowing for the pre-existing Windows path
  failures).

## Out of scope

- The other audit issues (#2, #3, #5-#12). Issue #1's same-origin fix and issue #2's fail-closed
  identity gate are already on `main` — don't re-touch `checkAccess`'s Origin or identity branches.
- Any frontend change. Nothing in `web/` needs to know about this.
- `scripts/collie-ctl.sh` — it never reads `COLLIE_HOST`, so it needs no change. Confirm with a grep
  before concluding otherwise.
- Reporting anything upstream.
- Changing `isHostAllowed` or the `LOOPBACK_HOST` regex used for the Host header. Different value,
  different threat.

## Versioning — do NOT bump

Land this as functional commits only, with **no** change to `herdr-plugin.toml`, `package.json`,
`web/package.json` or `CHANGELOG.md`.

The repo's actual practice (`git log -- package.json`) is: features land as their own commits, then
a separate `chore(release):` commit cuts the version so the CHANGELOG can cite the short hashes.
The two prior security fixes on `main` — `528671d` (issue #2) and its doc commit — are sitting
unreleased on `0.29.0` right now for exactly that reason. `scripts/check-version.sh` stays green
because all four files keep agreeing on `0.29.0`.

**Flag for the maintainer at release time:** by the letter of `CLAUDE.md`'s bump policy this is a
**MAJOR** change — "a workflow that used to work and now doesn't". An operator running
`COLLIE_HOST=0.0.0.0` today will find the service refuses to start after upgrading. On a 0.x
project that means `0.29.0 → 1.0.0`, which is a large statement for a security fix, so the axis
call belongs to whoever cuts the release alongside whatever else lands with it. Don't decide it
inside this change.

Suggested commit subject: `Refuse a non-loopback bind and reject non-loopback peers`.
