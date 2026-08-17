# Gate Notification Settings as Writes, Require Origin on Mutations, and Bound Update Checks (Issue #8)

## Summary

Promoted bridge-wide notification endpoints (`POST /api/notifications/snooze`, `POST /api/notifications/prefs`, and `POST /api/subscribe`) from `"read"` to `"write"` access level under `COLLIE_DEVICE_HEADER` enforcement. Enforced `Origin` header validation on all state-changing HTTP methods from non-loopback hosts. Capped snooze duration at 7 days and throttled on-demand upstream release checks to once every 60 seconds. Updated the web UI to disable notification settings and surface explicit read-only notices for unauthorized devices.

## Context & Motivation

Under `COLLIE_DEVICE_HEADER`, unallowlisted devices or callers without the device header operate in a read-only role intended to bound damage. However, notification preferences and snooze are bridge-wide state ([ADR 0003](file:///C:/claudeOS/Projects/collie/.adr/0003-one-shared-seen.md)):
- A read-only client or same-host local user could mute all push notifications across all devices (e.g. `snoozedUntil: 9e15`) or turn off all alert types (`{blocked: false, done: false, updates: false}`), suppressing "agent is waiting" notifications for the operator.
- Push subscription (`POST /api/subscribe`) constitutes a standing grant to receive operator alerts.
- State-changing `POST` routes at read level bypassed the `checkAccess` `Origin` requirement because the check previously only evaluated `level === "write"`.
- Sequential loops against `POST /api/update/check` bypassed in-flight de-duplication and risked exhausting anonymous GitHub API rate limits (60/hr).

## Changes Made

### 1. Device Gate & Origin Enforcement (`bridge/server.ts`)
- **Route Access Levels**:
  - `POST /api/subscribe`, `POST /api/notifications/snooze`, and `POST /api/notifications/prefs` now require `"write"` access via `guard(req, cfg, "write")`.
  - `GET /api/notifications/prefs` and `POST /api/update/check` remain at `"read"` level.
- **State-Changing Method Check**:
  - Added `isStateChangingMethod(req: Request): boolean` identifying any HTTP method other than `GET` or `HEAD`.
  - Updated `checkAccess` so that any write-level or state-changing request from a non-loopback host without a valid `Origin` header is rejected (`{ ok: false, reason: "origin required" }`).
- **Input Validation**:
  - Hardened `POST /api/notifications/snooze` to reject `NaN` and `Infinity` with HTTP 400 (`bad snoozedUntil`).

### 2. Snooze Duration Cap (`bridge/snooze.ts`)
- Introduced `MAX_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000` (7 days) and `clampSnooze(mutedUntil, now)`.
- Clamped requested deadlines in `Snooze.set()` and clamped legacy/persisted values during `Snooze.load()`, preventing indefinite muting.

### 3. Update Check Rate Limiting (`bridge/update.ts`)
- Defined `CHECK_MIN_INTERVAL_MS = 60_000` (60 seconds).
- Added `lastAttemptAt` tracking in `UpdateMonitor.checkRelease()`. Sequential calls within the cooldown interval resolve immediately without initiating upstream GitHub requests.

### 4. Web UI & Push Client Adjustments (`web/src/`)
- **`web/src/lib/push.ts`**:
  - Defined `EnableFailure` type including `"refused"`.
  - Updated `enablePush()` so HTTP 403 responses return `{ ok: false, reason: "refused" }` without caching the endpoint or clearing `collie:push-disabled`.
- **`web/src/components/snooze-control.tsx` & `web/src/components/notify-prefs-control.tsx`**:
  - Added `readOnly?: boolean` props to disable controls and render `"Read-only — this device isn't authorised to change notification settings."`.
  - Handled 403 errors by dispatching descriptive status error messages.
- **`web/src/hooks/use-notify-prefs.ts`**:
  - Reverted optimistic toggles on API errors and set user-visible status error messages on 403.
- **`web/src/routes/settings.tsx`**:
  - Checked `isReadOnly(root?.device)` and passed `readOnly` into `NotifyPrefsControl`, `SnoozeControl`, and disabled the push subscription toggle with reason explanation.

### 5. Architectural Record & Documentation
- **`.adr/0012-notification-settings-are-writes.md`**: Recorded the decision to classify notification mutations as writes without adding a separate "settings" access level.
- **`.adr/README.md`**: Added ADR 0012 to the index.
- **`README.md` & `ARCHITECTURE.md`**: Updated security model documentation, Variant B proxy specifications, and audit log scope.
- **`requests/issue-8-read-level-posts.md` & `specs/752e3ee2_read-level-posts.md`**: Captured request requirements and technical implementation plan.

## Verification

### Backend Tests
```bash
bun test bridge/server.test.ts bridge/snooze.test.ts bridge/update.test.ts
bun test ./bridge
```

### Frontend Tests
```bash
cd web && bun run test && cd ..
```

### Typecheck & Build
```bash
bun run build
```
