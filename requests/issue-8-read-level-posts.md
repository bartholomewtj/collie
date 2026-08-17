# Issue #8 — Low: read-level POSTs (snooze, prefs, subscribe, update/check) change state and can silence alerts

## What
`server.ts:1146` only demands an Origin for `level === "write"`. These POST routes are state-changing but gated `"read"`:
- `POST /api/notifications/snooze` (`:321-333`): `snoozedUntil: 9e15` accepted (`snooze.ts:129-136`), persisted, mutes every push until the operator notices.
- `POST /api/notifications/prefs` (`:341-368`): `{"blocked":false,"done":false,"updates":false}`.
- `POST /api/subscribe` (see #7).
- `GET /api/update/check` (`:370-378`): any read-level client triggers a GitHub API fetch; only de-duped while in flight, so a loop burns the anonymous 60/hr limit.
- `SEEN_HEADER` on GET clears "unseen" state.

A same-host uid or a non-allowlisted device can suppress the operator's "agent is waiting" alerts. README frames the device gate as "bounds damage, not disclosure"; this is damage at read level.

## Fix
- Treat snooze/prefs/subscribe as `"write"` under the device gate (or add a third "settings" level).
- Require Origin on all POSTs.
- Cap `snoozedUntil` (e.g. at most 7 days from now).
- Rate-limit `/api/update/check` to one upstream fetch per 60 s regardless of callers.
