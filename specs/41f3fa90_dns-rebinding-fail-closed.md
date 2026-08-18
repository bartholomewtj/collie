# Plan — Issue #3: DNS rebinding works by default

Branch: `fix/3-dns-rebinding-default` (already checked out).

## The bug

`bridge/server.ts:1154` only runs the Host-header allowlist when `cfg.publicHosts` is non-empty, and
`COLLIE_PUBLIC_HOSTS` defaults to `[]` (`bridge/config.ts:271`). So in the shipped default config a
DNS-rebound page that sends `Host: evil.example:8787` **and** `Origin: http://evil.example:8787`
satisfies `originHost === host` at `server.ts:1170` and gets full **reads and writes** against
`127.0.0.1:8787`. The README calls the allowlist "strongly recommended"; the code ships the hole open.

`bridge/server.test.ts:234-241` currently *asserts* the hole ("empty publicHosts keeps legacy
behaviour"). That test is the thing being inverted.

## The fix, in one sentence

Make Host validation **always on and fail-closed**, teach the bridge the hosts it legitimately answers
on (loopback, `COLLIE_PUBLIC_HOSTS`, `COLLIE_ALLOWED_ORIGINS` hosts, and the Tailscale identity
`collie-ctl.sh` already discovers), and give the operator one explicit, loudly-warned opt-out.

Reads are closed too, not just writes. A rebound page reading a terminal grid is the same leak as
writing to one.

## Design decisions (do not re-litigate these mid-build)

1. **Fail closed for every non-loopback Host, reads and writes.** The issue's fallback option
   ("at minimum refuse writes") leaves pane output readable to a rebound page. One uniform rule is
   also one branch to test.
2. **The bridge does not shell out to `tailscale`.** `scripts/collie-ctl.sh` already resolves the
   MagicDNS name (`self_dnsname()`, line 176) for `tailscale serve`, and `write_unit()` runs on every
   `cmd_start`. Push the value into the service environment from there. The bridge stays free of
   subprocesses.
3. **Tailnet IPs count too.** Plenty of operators reach the bridge at `http://100.x.y.z:8787` rather
   than the MagicDNS name. `tailscale status --json` exposes `Self.TailscaleIPs`; ship them alongside
   the DNS name so the obvious access path doesn't start 403ing.
4. **The opt-out is `COLLIE_ALLOW_ANY_HOST=1`**, not "leave `COLLIE_PUBLIC_HOSTS` empty". An insecure
   state must be something the operator typed.
5. **This is a MAJOR bump: `0.29.0` → `1.0.0`.** A Variant C/E deployment (`COLLIE_SKIP_SERVE=1`,
   operator-run reverse proxy) with no `COLLIE_PUBLIC_HOSTS` set stops working after upgrade until
   the operator pins it. Per `CLAUDE.md` → Versioning, "the operator must change something" is the
   MAJOR axis, and the rule's own example shows a pre-1.0 project jumping to `1.0.0`. Do not soften
   this to a MINOR by carving out an exception for the skipServe case.

## Files to change

### 1. `bridge/config.ts`

Add two fields to the `Config` interface. Put `tailscaleHosts` next to `publicHosts` (~line 182) and
`allowAnyHost` right after it.

```ts
  /**
   * Hosts this bridge is actually published on, discovered by `collie-ctl.sh` from
   * `tailscale status --json` (Self.DNSName + Self.TailscaleIPs) and injected as
   * COLLIE_TAILSCALE_HOSTS. Operators don't set this — it exists so the Host allowlist can be
   * fail-closed by default without every tailnet deployment needing COLLIE_PUBLIC_HOSTS. Matched
   * with or without a port. Empty under COLLIE_SKIP_SERVE=1: the operator owns that ingress and
   * must pin {@link publicHosts} themselves.
   */
  tailscaleHosts: string[];
  /**
   * Escape hatch that turns Host validation OFF entirely (COLLIE_ALLOW_ANY_HOST=1), restoring the
   * pre-1.0 behaviour where any Host passed as long as Origin matched it. That is the DNS-rebinding
   * hole (issue #3) — a hostile page rebinds to 127.0.0.1 and sends Host==Origin==evil.example.
   * Only for a deployment whose real Host genuinely can't be enumerated. Warned about at startup.
   */
  allowAnyHost: boolean;
```

Rewrite the `publicHosts` doc comment (lines ~176-182) — it currently says "When non-empty, the
operator has opted in… Empty = validation off (legacy behaviour)". Validation is now always on;
`publicHosts` is the way to *add* hosts beyond loopback and the discovered Tailscale ones.

In the builder object (~line 271), next to `publicHosts`:

```ts
    tailscaleHosts: envList("COLLIE_TAILSCALE_HOSTS"),
    allowAnyHost: envBool("COLLIE_ALLOW_ANY_HOST", false),
```

### 2. `bridge/server.ts` — `isHostAllowed()` (~line 1197)

Accept the Tailscale hosts, port-tolerantly. In https serve mode the browser sends `Host:
name.tailnet.ts.net` (no port, it's 443); in `COLLIE_SERVE_MODE=http` it sends `name:8787`. Match both
from one entry.

```ts
export function isHostAllowed(host: string, cfg: Config): boolean {
  if (!host) return false;
  if (LOOPBACK_HOST.test(host)) return true;
  if (cfg.publicHosts.includes(host)) return true;
  // Discovered Tailscale identities match bare or with any port: https serve answers on 443 (no
  // port in Host), http serve answers on COLLIE_PORT. One entry covers both modes.
  const bare = host.replace(/:\d+$/, "");
  if (cfg.tailscaleHosts.some((h) => h === host || h === bare)) return true;
  return cfg.allowedOrigins.some((o) => {
    try {
      return new URL(o).host === host;
    } catch {
      return false;
    }
  });
}
```

Note `bare` strips a trailing `:\d+` only, so a bracketed IPv6 literal (`[fd7a::1]`) is left intact
and an entry of `[fd7a::1]` still matches `[fd7a::1]:8787`.

### 3. `bridge/server.ts` — `checkAccess()` (~line 1152)

Drop the `cfg.publicHosts.length > 0` precondition:

```ts
  // Host-header allowlist — ALWAYS ON, before the Origin logic, so a rebinding request
  // (Host==Origin==evil) never reaches it. COLLIE_ALLOW_ANY_HOST=1 is the operator's explicit
  // opt-out and re-opens issue #3.
  if (!cfg.allowAnyHost && !isHostAllowed(host, cfg)) {
    return { ok: false, reason: "host not allowed" };
  }
```

Rewrite the first bullet of the `checkAccess` doc block (lines ~1126-1133). It currently reads "Host
allowlist (opt-in): when COLLIE_PUBLIC_HOSTS is set… Empty COLLIE_PUBLIC_HOSTS keeps the legacy
behaviour so existing deployments don't break". Replace with the fail-closed description: the Host
must be loopback, a `COLLIE_PUBLIC_HOSTS` entry, a discovered Tailscale host, or an allowed origin's
host; otherwise rejected before any Origin logic. Name `COLLIE_ALLOW_ANY_HOST` as the opt-out and
issue #3 as the reason.

### 4. `bridge/server.ts` — `startupWarnings()` (~line 448)

The current warning ("COLLIE_PUBLIC_HOSTS is empty — Host-header validation is OFF") is now false in
the default case. Replace that `if` block with two:

```ts
  if (cfg.allowAnyHost) {
    warnings.push(
      `[bridge] WARNING: COLLIE_ALLOW_ANY_HOST=1 — Host-header validation is OFF, so a DNS-rebound page can reach this bridge as if it were same-origin. Unset it and set COLLIE_PUBLIC_HOSTS to the host(s) you serve on.`,
    );
  } else if (
    cfg.publicHosts.length === 0 &&
    cfg.tailscaleHosts.length === 0 &&
    cfg.allowedOrigins.length === 0
  ) {
    warnings.push(
      `[bridge] WARNING: no non-loopback Host is allowed — every request except one addressed to localhost/127.0.0.1 will be rejected with "host not allowed". Set COLLIE_PUBLIC_HOSTS to the exact host(s) you serve on (required behind your own reverse proxy, see README → Variant C/E).`,
    );
  }
```

That second branch is the diagnostic for the deployments this change breaks — make its wording carry
the fix.

### 5. `scripts/collie-ctl.sh`

**a. Extend `self_dnsname()` (line 176) into `self_hosts()`.** Keep `self_dnsname()` as-is —
`bridge_url()` (line 181) and the serve publisher (line 857) both want the single name, and line 857
treats an empty result as fatal. Add a sibling that emits a comma-separated DNS-name + IP list:

```bash
# The host identities this node actually answers to on the tailnet — MagicDNS name plus Self
# TailscaleIPs — comma-joined for COLLIE_TAILSCALE_HOSTS. The bridge's Host allowlist is fail-closed
# (issue #3), and without this every tailnet deployment would need COLLIE_PUBLIC_HOSTS set by hand.
# Prints nothing if tailscale is absent or not up; callers must tolerate empty.
self_hosts() {
  tailscale status --json 2>/dev/null | bun -e \
    "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const s=JSON.parse(d).Self;const o=[];if(s.DNSName)o.push(s.DNSName.replace(/\.\$/,''));for(const ip of s.TailscaleIPs||[])o.push(ip.includes(':')?'['+ip+']':ip);process.stdout.write(o.join(','))}catch{}})"
}
```

IPv6 addresses get bracketed so they compare equal to what a browser puts in a `Host` header.

**b. Compute it once and pass it down all three launch paths.** Under `COLLIE_SKIP_SERVE=1` leave it
empty — Collie publishes nothing on the tailnet there, so the operator's proxy Host is the only one
that matters and `COLLIE_PUBLIC_HOSTS` is theirs to set.

Add near the top of `cmd_start()` (line 446), before the `have_systemd` branch:

```bash
  COLLIE_TAILSCALE_HOSTS=""
  if [ "${COLLIE_SKIP_SERVE:-}" != "1" ]; then COLLIE_TAILSCALE_HOSTS="$(self_hosts)"; fi
  export COLLIE_TAILSCALE_HOSTS
```

- **`write_unit()` (line 334-359):** add one line beside the other `Environment=` lines, but only when
  non-empty — a bare `Environment=COLLIE_TAILSCALE_HOSTS=` is harmless but noisy, and an empty value
  is what `envList` produces anyway. Simplest correct shape: build the line into a variable before
  the heredoc and interpolate it.

  ```bash
  local ts_env=""
  [ -n "${COLLIE_TAILSCALE_HOSTS:-}" ] && ts_env="Environment=COLLIE_TAILSCALE_HOSTS=${COLLIE_TAILSCALE_HOSTS}"
  ```
  then place `${ts_env}` on its own line after `Environment=HERDR_PLUGIN_CONFIG_DIR=...`. Because
  `EnvironmentFile=-${CONFIG_DIR}/.env` is listed *after* the `Environment=` lines, an operator who
  sets `COLLIE_TAILSCALE_HOSTS` in `.env` still wins — that's the right precedence.

- **`start_unsupervised()` (line 434):** add `COLLIE_TAILSCALE_HOSTS="${COLLIE_TAILSCALE_HOSTS:-}"` to
  the inline env prefix on the `nohup` line.

- **launchd path.** `write_agent()` bakes only paths into the plist (see its header comment — values
  are deliberately kept out because `.env` is mode 600), and `cmd_exec_bridge()` is what actually
  launches. `cmd_exec_bridge` runs at *login*, when `tailscale` may not be up yet, so do the discovery
  there rather than at install time, and tolerate empty:

  ```bash
  if [ "${COLLIE_SKIP_SERVE:-}" != "1" ] && [ -z "${COLLIE_TAILSCALE_HOSTS:-}" ]; then
    COLLIE_TAILSCALE_HOSTS="$(self_hosts)"
  fi
  export COLLIE_TAILSCALE_HOSTS="${COLLIE_TAILSCALE_HOSTS:-}"
  ```
  Put it with the other `export`s (lines 426-428). The `-z` guard means an explicit `.env` value (already
  sourced at line 42) is never overwritten.

### 6. `.adr/0014-host-validation-is-fail-closed.md`

This decision closes off an option someone will reasonably re-propose — "leave the Host allowlist
opt-in so nobody's deployment breaks" — which is exactly the ADR shape described in `CLAUDE.md`.
Follow the format in `.adr/README.md`. It should record: the default was insecure and the README was
doing the work the code should have; opt-in security is not security; the bridge learns its own hosts
from ctl rather than shelling out itself; the skipServe/Variant-C deployment is the deliberate
breakage and the startup warning is its diagnostic; `COLLIE_ALLOW_ANY_HOST` exists so the insecure
state is typed, not defaulted into.

Add a line to `CLAUDE.md` → *Security posture* pointing at it, in the same short-normative style the
other ADR references use — something like: "**Host validation is fail-closed** — a non-loopback Host
must be loopback, a `COLLIE_PUBLIC_HOSTS` entry, a ctl-discovered Tailscale host, or an allowed
origin's host ([ADR 0014](./.adr/0014-host-validation-is-fail-closed.md))."

## Tests

### `bridge/server.test.ts` — this is the largest and most error-prone part

**The sweep matters more than the new tests.** `cfg()` (line 40) defaults to empty `publicHosts`, and
roughly 30 call sites pass a non-loopback `Host` (`"h"`, `"collie.example.ts.net"`,
`"collie.ts.net"`, `"evil.example.com"`) with a default config. Every one of those now short-circuits
on `"host not allowed"` before reaching the rule it was written to test.

Fix this **at the helper, not at 30 call sites**: add `allowAnyHost: true` to the `cfg()` defaults so
existing tests keep testing what they were written to test, then have the new Host-validation
describe block build its configs with `cfg({ allowAnyHost: false, ... })`. Add a comment on the
`cfg()` default explaining why it's there, so nobody reads it as the product default.

`deviceAuth()` (lines 736-845) doesn't call `checkAccess`, so those are unaffected either way — but
`guard()` (line 784-786) does, and it uses `host: "collie.ts.net"`.

New/changed assertions, in the `checkAccess — Host-header validation` describe (line 198):

- **Invert `bridge/server.test.ts:234-241`.** Retitle from "empty publicHosts keeps legacy behaviour"
  to something like "the default config rejects a rebound Host==Origin==evil (issue #3)" and assert
  `{ ok: false, reason: "host not allowed" }` for **both** `"read"` and `"write"` against
  `cfg({ allowAnyHost: false })`. Rewrite the body comment — it currently explains that the hole is
  intentional.
- Default (fail-closed) config + loopback Host passes for read and write.
- `cfg({ allowAnyHost: false, tailscaleHosts: ["collie.example.ts.net", "100.64.0.1"] })`:
  - Host `collie.example.ts.net` (no port) passes — https serve.
  - Host `collie.example.ts.net:8787` passes — http serve mode, same entry.
  - Host `100.64.0.1:8787` passes — raw tailnet IP.
  - Host `evil.example.com` rejected.
  - Host `evil.com:8787` whose bare form is not an entry — rejected. (Guards the `bare` strip from
    being too eager.)
- `cfg({ allowAnyHost: true })` + `Host == Origin == evil.example.com` passes — the opt-out works.
- The existing `publicHosts`-set tests (lines 199-232) should pass unchanged once they're built with
  `allowAnyHost: false`.

In the `checkAccess — Origin required for writes` describe (line 243): these use
`host: "collie.example.ts.net"` with `cfg()`. With `allowAnyHost: true` in the helper defaults they
keep passing untouched — verify that rather than assuming it.

Startup-warning tests (lines 886-897): the two `publicHosts` tests must be rewritten.
- `cfg({ allowAnyHost: true })` → warning containing `COLLIE_ALLOW_ANY_HOST` fires.
- `cfg({ publicHosts: [], tailscaleHosts: [], allowedOrigins: [] })` → the "no non-loopback Host is
  allowed" warning fires.
- `cfg({ tailscaleHosts: ["collie.example.ts.net"] })` → **no** Host warning (the normal, healthy
  tailnet deployment must be quiet).
- `cfg({ publicHosts: ["collie.example.ts.net"] })` → no Host warning.

### `bridge/config.test.ts`

- Add `"COLLIE_TAILSCALE_HOSTS"` and `"COLLIE_ALLOW_ANY_HOST"` to the env-key reset list at line 33 —
  miss this and tests leak state into each other.
- Add a parse test alongside the `COLLIE_PUBLIC_HOSTS` one at line 264: `COLLIE_TAILSCALE_HOSTS`
  splits/trims the same way, and `allowAnyHost` defaults to `false` / reads `1` as `true`.

### `scripts/collie-ctl.test.sh`

- Extend the fake `tailscale` in `install_fake_tailscale()` (line 86) so `status --json` returns
  `{"Self":{"DNSName":"host.example.","TailscaleIPs":["100.64.0.1","fd7a::1"]}}`. Confirm the existing
  tailscale tests still pass — `self_dnsname()` reads only `DNSName`, so they should.
- Add an assertion in whichever case already runs `cmd_start` with systemd faked: the generated
  `${UNIT_FILE}` contains `Environment=COLLIE_TAILSCALE_HOSTS=host.example,100.64.0.1,[fd7a::1]`.
- Add a case: with `COLLIE_SKIP_SERVE=1`, the unit contains **no** `COLLIE_TAILSCALE_HOSTS` line.

## Docs

- **`README.md:137-142`** — "Optional Host allowlist" is no longer optional. Retitle to **Host
  allowlist (fail-closed)** and say: the bridge answers only to loopback, the Tailscale name/IPs
  `collie-ctl.sh` discovers, `COLLIE_PUBLIC_HOSTS`, and `COLLIE_ALLOWED_ORIGINS` hosts; anything else
  is rejected before the Origin check. Mention `COLLIE_ALLOW_ANY_HOST=1` as the discouraged opt-out.
- **`README.md:285`** — the sample `logs` output shows the old warning. Under a default tailnet
  install the Host warning no longer fires at all, so drop that line from the sample and fix the
  paragraph at 287-291 that says "**Both** WARNINGs are expected on a fresh install" — it's one now.
- **`README.md:318-324`** — the "close both in one sitting" `.env` block. Same fix: it's one warning
  to close (`COLLIE_TRUSTED_USER`), and `COLLIE_PUBLIC_HOSTS` becomes "only if you serve on a host
  Collie can't discover — behind your own proxy".
- **`README.md:780` and `:838`** (Variants C/E, reverse proxy) — upgrade `COLLIE_PUBLIC_HOSTS` from
  advice to **required**. These are the deployments that break; make that unmissable.
- **`README.md:635`** — same wording pass.
- Add an **upgrade note** for 1.0.0 near the top of the README's config section or in the CHANGELOG
  entry: if you run `COLLIE_SKIP_SERVE=1` behind your own proxy and never set `COLLIE_PUBLIC_HOSTS`,
  set it before upgrading or every request returns 403 `host not allowed`.

## Version bump — MANDATORY, do not skip

Per `CLAUDE.md` → Versioning, all four must agree:

1. `herdr-plugin.toml:3` → `version = "1.0.0"`
2. `package.json:3` → `"version": "1.0.0"`
3. `web/package.json:3` → `"version": "1.0.0"`
4. `CHANGELOG.md` → new `## [1.0.0] - 2026-08-17` heading above the `## [0.29.0]` one.

CHANGELOG style is crisp one-liners, and the cited short hashes only exist once the functional commits
land — so **commit the functional work first, then cut the release commit**. Entry shape:

```markdown
## [1.0.0] - 2026-08-17

### Changed

- **BREAKING: Host-header validation is on by default and fails closed** — the bridge answers only to loopback, the Tailscale name/IPs `collie-ctl.sh` discovers, `COLLIE_PUBLIC_HOSTS`, and `COLLIE_ALLOWED_ORIGINS` hosts. A DNS-rebound `Host: evil.example` no longer gets reads or writes (#3, <hash>)
- **`COLLIE_SKIP_SERVE=1` deployments must now set `COLLIE_PUBLIC_HOSTS`** — behind your own reverse proxy Collie can't discover the public host, so an unpinned install returns 403 `host not allowed` until you set it (#3, <hash>)

### Added

- `COLLIE_ALLOW_ANY_HOST=1` — explicit opt-out that turns Host validation off, with a loud startup warning. Re-opens the rebinding hole; only for a deployment whose Host genuinely can't be enumerated (#3, <hash>)
- `collie-ctl.sh` injects `COLLIE_TAILSCALE_HOSTS` (MagicDNS name + tailnet IPs) into the service env, so a normal tailnet install needs no manual allowlist (#3, <hash>)
```

Then run `bash scripts/check-version.sh` — it must print `✓`.

## Verify

```bash
bun test ./bridge                 # server.test.ts, config.test.ts
bash scripts/collie-ctl.test.sh   # the ctl lifecycle in a sandboxed HOME
bash scripts/check-version.sh     # must print ✓
```

`bun run build` at the root typechecks both sides — run it if `tsc` is available here; the new
`Config` fields will break any test helper that builds a `Config` literal without them, and
`noUnusedLocals`/`noUnusedParameters` are on.

**Windows caveat:** ~39 backend tests fail on this machine for POSIX-path reasons unrelated to this
change, and `scripts/collie-ctl.test.sh` needs a POSIX shell with `systemctl` faked — it may not run
here at all. Judge by the tests you touched, and record what you couldn't execute rather than
claiming a green suite. Capture the baseline (`bun test ./bridge` before your edits) so the
before/after failure count is comparable.

## Done means

- `checkAccess(req({ origin: "https://evil.example.com", host: "evil.example.com" }), cfg_default)`
  returns `{ ok: false, reason: "host not allowed" }` for read **and** write.
- A loopback Host, a `COLLIE_PUBLIC_HOSTS` entry, a `COLLIE_TAILSCALE_HOSTS` entry (with or without a
  port), and an allowed origin's host all still pass.
- `COLLIE_ALLOW_ANY_HOST=1` restores the old behaviour and produces a startup warning.
- `collie-ctl.sh start` writes `Environment=COLLIE_TAILSCALE_HOSTS=…` into the systemd unit, and
  omits it under `COLLIE_SKIP_SERVE=1`.
- `bridge/server.test.ts:234-241` asserts rejection, not the legacy pass.
- Version is `1.0.0` in all three files with a matching CHANGELOG entry; `check-version.sh` prints `✓`.
- `.adr/0014-host-validation-is-fail-closed.md` exists and `CLAUDE.md` links it.

## Out of scope

- The other audit issues (#2, #4-#12). Issues #1 and #2 are already fixed on this branch's ancestors —
  don't revisit the Origin gate or the `COLLIE_TRUSTED_USER` fail-closed change.
- Any frontend change beyond what tests need. The web app talks to its own origin, so it is unaffected.
- Reporting upstream, opening the PR, or tagging the release — the human does the merge and the tag.
- Adding a second managed front door or touching `tailscale serve` publishing logic
  ([ADR 0001](./.adr/0001-one-managed-front-door.md)). `self_hosts()` only *reads* `tailscale status`.
