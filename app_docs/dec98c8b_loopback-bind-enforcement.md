# Enforce Loopback Bind and Reject Non-Loopback Peers (Issue #4)

## Summary

The bridge now enforces a loopback bind at boot and verifies TCP peer addresses at request time. `loadConfig()` refuses to start on a non-loopback `COLLIE_HOST` unless `COLLIE_ALLOW_NON_LOOPBACK_BIND=1` is explicitly set, and incoming requests from non-loopback TCP peers are rejected with HTTP 403 before routing.

## Context & Motivation

The bridge's security model relies on binding strictly to loopback:
- `Tailscale-User-Login` headers are trusted because only `tailscale serve` (running locally) can reach the port.
- `COLLIE_DEVICE_HEADER` forwarding assumes a trusted local proxy.
- The same-origin gate allows requests where `Origin` matches `Host` (both client-controlled).

Previously, `COLLIE_HOST` accepted non-loopback values (such as `0.0.0.0`) with only a startup log warning, which effectively allowed untrusted network clients to forge identity headers, device headers, or Host headers. Additionally, `startupWarnings` incorrectly treated IPv6 loopback `::1` as non-loopback.

## Changes Made

### 1. Loopback Bind Validation & Boot Failure (`bridge/config.ts`, `bridge/index.ts`)
- **`isLoopbackBindHost(host: string): boolean`**: Pure helper validating loopback host formats (`127.0.0.0/8`, `localhost`, `::1`, `[::1]`, and `0:0:0:0:0:0:0:1`). Rejects wildcard binds (`0.0.0.0`, `::`), LAN addresses, and arbitrary hostnames.
- **`loadConfig()`**: Throws an error when `COLLIE_HOST` is non-loopback and `COLLIE_ALLOW_NON_LOOPBACK_BIND` is not enabled.
- **`Config.allowNonLoopbackBind`**: New boolean config field parsed via `envBool("COLLIE_ALLOW_NON_LOOPBACK_BIND", false)`.
- **`bridge/index.ts`**: Wrapped `loadConfig()` in a try/catch block to log a clean `[bridge] FATAL: <message>` without burying the error in a stack trace, exiting with status code 1.

### 2. TCP Peer Address Gate & Startup Warnings (`bridge/server.ts`)
- **`isLoopbackPeer(address: string | null | undefined): boolean`**: Pure helper validating kernel TCP peer addresses (handles IPv4 `127.0.0.0/8`, IPv6 `::1`, and IPv4-mapped IPv6 `::ffff:127.0.0.1`; abstains on `null`/`undefined`).
- **`fetch(req, srv)`**: Added a pre-routing peer-address check. If `allowNonLoopbackBind` is false and `srv.requestIP(req)?.address` is not loopback, returns HTTP 403 (`non-loopback peer rejected`).
- **`startupWarnings(cfg)`**: Updated to use `isLoopbackBindHost`. Resolves the spurious warning for `::1` and warns about wide binds only when `COLLIE_ALLOW_NON_LOOPBACK_BIND` is explicitly active.

### 3. Test Coverage (`bridge/config.test.ts`, `bridge/server.test.ts`)
- **`bridge/config.test.ts`**:
  - Added `COLLIE_ALLOW_NON_LOOPBACK_BIND` to environment variable isolation cleanup.
  - Added tests verifying that `loadConfig()` throws on non-loopback host `0.0.0.0` and succeeds when `COLLIE_ALLOW_NON_LOOPBACK_BIND=1` is supplied.
  - Added table tests for `isLoopbackBindHost`.
- **`bridge/server.test.ts`**:
  - Updated test helper `cfg()` with `allowNonLoopbackBind: false`.
  - Added table tests for `isLoopbackPeer` across IPv4, IPv6, and IPv4-mapped representations.
  - Added tests for `startupWarnings` verifying no warning on `::1` and appropriate warning on `0.0.0.0` with override.

### 4. Documentation & Design Specs (`README.md`, `ARCHITECTURE.md`, `specs/dec98c8b_loopback-bind-enforcement.md`)
- **`README.md`**: Updated proxy and tailnet configuration examples (`COLLIE_HOST`) highlighting enforced loopback binding, and documented `COLLIE_ALLOW_NON_LOOPBACK_BIND`.
- **`ARCHITECTURE.md`**: Documented loopback bind enforcement and TCP peer verification in Section 6.
- **`specs/dec98c8b_loopback-bind-enforcement.md`**: Implementation design spec detailing requirements, threat model, and verification steps.

## Verification

Run bridge unit tests:
```bash
bun test ./bridge/config.test.ts
bun test ./bridge/server.test.ts
```

Run typecheck across the project:
```bash
bun run build
```
