# Loopback Origin Bypass Removal and JSON Content-Type Enforcement (Issue #1)

## Summary

Removed the implicit loopback-Origin bypass from the same-origin gate and enforced strict `application/json` Content-Type validation across all JSON-accepting endpoints in the Collie bridge server.

## Context & Motivation

Previously, the same-origin check in `bridge/server.ts` allowed any request with an `Origin` matching `localhost`, `127.0.0.1`, or `[::1]` regardless of the target `Host` header. This allowed malicious or untrusted local web applications to send cross-origin requests to remote Collie bridge instances.

Additionally, browsers allow certain simple POST requests (such as `text/plain`, `application/x-www-form-urlencoded`, or `multipart/form-data`) without triggering a CORS preflight (`OPTIONS`) request. Without strict Content-Type validation, cross-origin write requests could reach JSON handlers.

## Changes Made

### 1. Same-Origin Gate Hardening
- **`bridge/server.ts` (`checkAccess`)**: Removed `LOOPBACK_HOST.test(originHost)` from the `allowed` evaluation. Requests with an `Origin` header now only pass if `originHost === host` or if the exact origin is explicitly listed in `cfg.allowedOrigins`.
- **`bridge/config.ts`**: Updated documentation for `Config.allowedOrigins` to reflect that loopback origins are no longer implicitly exempt.
- **`.env.example` & `README.md`**: Updated documentation explaining that separate local frontend development servers (e.g. `http://localhost:5173`) must be listed in `COLLIE_ALLOWED_ORIGINS`. Updated curl usage example to include the `Content-Type: application/json` header.

### 2. Mandatory `application/json` Content-Type Verification
- **`bridge/server.ts`**:
  - Implemented `isJsonContentType(value: string | null): boolean` to verify that `Content-Type` is `application/json` (ignoring parameters such as `charset=utf-8` and case).
  - Implemented `requireJsonBody(req: Request): Response | null`, which returns a `415` HTTP status ("expected application/json") if the `Content-Type` header does not match.
  - Applied `requireJsonBody` checks before parsing JSON payloads in:
    - `/api/notifications/subscribe` (POST)
    - `/api/notifications/quiet` (POST)
    - `/api/notifications/prefs` (POST)
    - `replyPane` (`/api/pane/:id/action`)
    - `keysPane` (`/api/pane/:id/keys`)
    - `renamePane` (`/api/pane/:id/rename`)
    - `renameTab` (`/api/tab/:id/rename`)
    - `createTab` (`/api/tab/new`)
    - `createWorkspace` (`/api/workspace/new`)

### 3. Test Coverage & Tooling
- **`bridge/server.test.ts`**:
  - Rewrote the loopback origin test to assert that non-matching loopback origins (`localhost:8787`, `127.0.0.1:8787`, `[::1]:8787`) are rejected with `{ ok: false, reason: "cross-origin rejected" }`.
  - Added tests asserting matching host loopback origins pass and configured origins in `COLLIE_ALLOWED_ORIGINS` pass.
  - Added test suite for `isJsonContentType`.
  - Added tests verifying that `text/plain` POST requests to `replyPane` and `keysPane` return `415` without invoking pane client operations.
- **`adws/adw_simple_sdlc.py`**: Added `retries=1` to the reviewer phase configuration.
- **`requests/issue-1-loopback-origin.md`**: Documented issue #1 requirements and scope.

## Verification

To verify the changes:
```bash
bun test bridge/server.test.ts
```
Or run the bridge test suite:
```bash
bun test ./bridge
```
