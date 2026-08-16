# Fail-Closed Identity Enforcement on Missing Tailscale-User-Login (Issue #2)

## Summary

Updated `COLLIE_TRUSTED_USER` access control in the bridge server to fail closed when the `Tailscale-User-Login` request header is absent. Added `COLLIE_TRUSTED_USER_OPTIONAL` as an explicit configuration flag for host-local development environments where direct, non-proxied requests lack identity headers.

## Context & Motivation

When `COLLIE_TRUSTED_USER` was configured, the bridge rejected mismatching `Tailscale-User-Login` headers but passed requests where the header was missing entirely. Under `tailscale serve`, identity headers are injected only for human tailnet user nodes; tagged nodes (such as CI runners and shared servers) have no user identity and send no `Tailscale-User-*` headers.

Because all requests proxied via `tailscale serve` arrive from `127.0.0.1`, the bridge could not distinguish direct local loopback callers from remote tagged tailnet nodes. Consequently, tolerating missing headers inadvertently granted all tagged nodes on the tailnet full read and write access to the bridge.

## Changes Made

### 1. Fail-Closed Access Control (`bridge/server.ts`)
- **`checkAccess`**: When `cfg.trustedUser` is defined, requests lacking a `Tailscale-User-Login` header are now rejected with `{ ok: false, reason: "identity required" }` (HTTP 403) for both read and write operations.
- **Exceptions**:
  - Requests without identity headers are permitted when `cfg.skipServe` is true (since no proxy injector exists).
  - Requests without identity headers are permitted when `cfg.trustedUserOptional` is true.
  - Mismatching logins continue to be rejected with `{ ok: false, reason: "identity not trusted" }` across all modes.
- **`startupWarnings`**: Added a startup warning when `COLLIE_TRUSTED_USER_OPTIONAL=1` is set, alerting operators that missing identity headers are accepted.

### 2. Configuration & Opt-Out Flag (`bridge/config.ts`)
- Added `Config.trustedUserOptional: boolean`, parsed from `COLLIE_TRUSTED_USER_OPTIONAL` via `envBool(..., false)`.
- Updated JSDoc documentation on `Config.trustedUser` and `Config.trustedUserOptional` clarifying tagged-node security implications and fail-closed behavior.

### 3. Test Coverage (`bridge/server.test.ts`, `bridge/config.test.ts`)
- **`bridge/server.test.ts`**:
  - Added tests verifying missing identity headers are rejected (`identity required`) for read and write requests when `trustedUser` is set.
  - Added test verifying spoofed loopback `Host` headers do not bypass identity enforcement.
  - Added tests confirming `skipServe` and `trustedUserOptional` permit absent identity headers while still rejecting mismatching identities.
  - Added unit test asserting `startupWarnings` warns when `trustedUserOptional` is active.
- **`bridge/config.test.ts`**:
  - Added `COLLIE_TRUSTED_USER_OPTIONAL` to the environment isolation key list.
  - Added default configuration test asserting `trustedUserOptional` defaults to `false`.
  - Added boolean toggle parsing tests covering truthy, falsy, and invalid values.

### 4. Documentation & Examples (`README.md`, `ARCHITECTURE.md`, `.env.example`, `specs/94e61cda_trusted-user-fail-closed.md`)
- **`README.md` & `ARCHITECTURE.md`**: Updated security architecture notes explaining why loopback requests cannot be implicitly trusted under `tailscale serve` and documenting the tagged-node vulnerability fix.
- **`.env.example`**: Added comments documenting `COLLIE_TRUSTED_USER_OPTIONAL` and its security trade-offs for local development.
- **`specs/94e61cda_trusted-user-fail-closed.md`**: Added design specification outlining the problem analysis, test plan, and implementation requirements.

## Verification

Run the modified unit and configuration tests:
```bash
bun test ./bridge/server.test.ts
bun test ./bridge/config.test.ts
```

Run root TypeScript typecheck:
```bash
bun run typecheck
```
