# Plan — read-level POSTs change state and can silence alerts (issue #8)

## What's wrong

`bridge/server.ts` gates four state-changing endpoints at `"read"` level, and `checkAccess` only
demands an `Origin` header when the level is `"write"`. Concretely:

| Route | Line today | Effect of the hole |
|---|---|---|
| `POST /api/subscribe` | `server.ts:337` | Any read-level caller registers a push endpoint that then receives every alert. |
| `POST /api/notifications/snooze` | `server.ts:356` | Any read-level caller mutes **every** device, bridge-wide. `snoozedUntil: 9e15` is accepted and persisted — a permanent, invisible mute. |
| `POST /api/notifications/prefs` | `server.ts:387` | Any read-level caller sets `{blocked:false, done:false, updates:false}` — no alert of any kind ever fires again. |
| `POST /api/update/check` | `server.ts:411` | Every call triggers an anonymous GitHub API fetch. `checkRelease()` only coalesces *concurrent* calls (`update.ts:216-222`), so a sequential loop burns the 60-requests/hour anonymous limit and starves the real 6-hourly check. |

Two separate defects compound:

1. **Level.** Snooze and prefs are *bridge-wide* state (`.adr/0003-one-shared-seen.md:16-17` says so
   explicitly). One non-allowlisted device, or any same-host uid that reaches the port, silences the
   operator's "agent is waiting" alerts for every device. README frames the device gate as bounding
   *damage*, not disclosure — this is damage, at read level.
2. **Origin.** Because the Origin requirement is keyed off `level === "write"`
   (`server.ts:1203`), a read-level POST from a non-loopback Host with **no Origin header at all**
   is accepted. That is the non-browser / Origin-stripped shape the write rule exists to refuse.

Plus two amplifiers with no gate of their own: `Snooze.set()` accepts any number (`snooze.ts:43`),
and nothing throttles the upstream release check.

## Decisions already made — do not re-litigate

- **Promote to the existing `"write"` level. Do not invent a third `"settings"` level.** The issue
  offers it as an option; it would be a name with no behaviour. The Origin rule, the device bit
  (`deviceAuth`) and the client-side predicate (`isReadOnly`) are all identical for a settings
  action and a terminal action, so a third level buys nothing and adds a case to every gate. What it
  *does* cost is honesty in the docs — the README/ARCHITECTURE sentences that enumerate the write set
  as "replies, keys, uploads, pane and tab create/close" become wrong. Fix the sentences (see
  *Change 5*); that is the cheaper half.
- **`GET /api/notifications/prefs` stays read-level.** Reading which alert kinds are on discloses
  nothing and mutates nothing. Only the POST moves.
- **`POST /api/update/check` stays read-level.** Checking a version is not operator-visible state.
  Its actual defect is the unbounded upstream fetch, and the fix for that is a cooldown, not a gate —
  a rate limit protects the 60/hr budget from *every* caller, including an allowlisted one in a
  reload loop. It still gains the Origin requirement via *Change 1*.
- **Snooze is clamped, not refused.** A too-far deadline is honest input from a client that computed
  it badly; silently capping it at 7 days keeps the control working and can't be bypassed.
- **`SEEN_HEADER` on GET is out of scope.** The issue mentions it as context, not in its Fix list. It
  is already guarded by `marksPaneSeen` (`server.ts:153-156`), which requires a custom request header
  a no-cors cross-site request cannot set. Nothing to do.
- **Push SSRF is issue #7, not this one.** Do not touch `push.ts` endpoint validation.
- **These routes are not added to `audit.log`.** The audit trail is a record of what was typed into
  a terminal, attributed to a device. Keep it that way; adjust the README sentence instead
  (*Change 5*).

## What "done" looks like

- A POST with no `Origin` header from a non-loopback Host is refused at **every** access level.
- With `COLLIE_DEVICE_HEADER` set, a non-allowlisted (or header-less) device gets 403 on subscribe,
  snooze and prefs-POST; it still reads snapshots, panes, history, prefs and the update status.
- `snoozedUntil` can never exceed 7 days from now — on the way in, and on the way back off disk.
- The upstream GitHub tags fetch happens at most once per 60 s no matter how many callers ask.
- The settings page tells a read-only device why those controls are off instead of failing silently.
- `bun test bridge/server.test.ts bridge/snooze.test.ts bridge/update.test.ts` and
  `cd web && bun run test` pass; `bun run build` typechecks clean.
- README, ARCHITECTURE and the route comments say what the code now does; ADR 0012 records why push
  subscription is no longer read-level.

## Scope

**Touch:**

- `bridge/server.ts` — Origin-on-state-change, three route levels, comments
- `bridge/snooze.ts` — the 7-day cap
- `bridge/update.ts` — the 60 s cooldown
- `bridge/server.test.ts`, `bridge/snooze.test.ts`, `bridge/update.test.ts`
- `web/src/lib/push.ts` — stop reporting success on a refused subscribe
- `web/src/routes/settings.tsx`, `web/src/components/snooze-control.tsx`,
  `web/src/components/notify-prefs-control.tsx`, `web/src/hooks/use-notify-prefs.ts`
- `web/src/components/snooze-control.test.tsx`, `web/src/components/notify-prefs-control.test.tsx`,
  `web/src/lib/push.test.ts`
- `README.md`, `ARCHITECTURE.md`
- `.adr/0012-notification-settings-are-writes.md` (new) + the index in `.adr/README.md`
- `requests/issue-8-read-level-posts.md` (new — the ADW input file is missing; see *Change 8*)

**Do NOT touch:** `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md` — this is a
fork PR. See *Versioning* at the bottom.

---

## Change 1 — require an Origin on every state-changing request (`bridge/server.ts`)

Today the Origin fallback at `server.ts:1203` reads:

```ts
} else if (level === "write" && !LOOPBACK_HOST.test(host)) {
```

The level describes *what the caller is allowed to do*, not *whether this call mutates*. Key the rule
off the method as well.

**1a. Add a pure helper** next to the other exported helpers (put it just above `checkAccess`, around
line 1156):

```ts
/**
 * Whether this request's method can change state — anything that is not a safe read.
 *
 * The Origin requirement keys off this as well as the access level, because the two are different
 * questions: `level` is what the caller is permitted to do, while the method is whether this
 * particular call mutates. A read-level POST (issue #8 — snooze, prefs, subscribe, update/check)
 * was accepted with no Origin at all from a remote Host, which is exactly the non-browser /
 * Origin-stripped shape the write rule exists to refuse. Browsers always send Origin on a POST.
 *
 * `req.method` is read defensively: the gate unit tests hand `checkAccess` a headers-only stub, so
 * an absent method reads as GET.
 */
export function isStateChangingMethod(req: Request): boolean {
  const method = (req.method ?? "GET").toUpperCase();
  return method !== "GET" && method !== "HEAD";
}
```

**1b. Use it** at `server.ts:1203`:

```ts
  } else if ((level === "write" || isStateChangingMethod(req)) && !LOOPBACK_HOST.test(host)) {
    // A state-changing request with no Origin header from a non-loopback Host isn't a real browser
    // request — refuse. Loopback (curl on the host) is still exempt.
    return { ok: false, reason: "origin required" };
  }
```

**1c. Update the `checkAccess` doc block** (`server.ts:1169-1171`). Replace the "Origin required for
writes" bullet with:

```
 *  - Origin required for anything state-changing: a request with no Origin is trusted only from
 *    loopback (curl on the host) if it is a write OR its method is not GET/HEAD. Browsers always
 *    send Origin on fetch/SW POSTs, so a missing Origin on a remote POST is a non-browser or
 *    Origin-stripped request — reject it whatever access level the route asks for (issue #8).
```

Leave the default `level = "read"` parameter alone — every existing caller keeps working.

## Change 2 — snooze, prefs-POST and subscribe become writes (`bridge/server.ts`)

Three one-word changes plus honest comments. **`GET /api/notifications/prefs` and
`POST /api/update/check` keep `"read"`.**

**2a. `/api/subscribe`** — `server.ts:334-338`. Replace the comment and the guard:

```ts
      if (pathname === "/api/subscribe" && req.method === "POST") {
        // Write-level: a subscription is a standing grant to receive every alert this bridge sends,
        // so an unallowlisted device must not be able to create one for itself (issue #8). It isn't
        // terminal-driving, but "read-only" has never meant "may register for the operator's push
        // stream" — see .adr/0012.
        const denied = guard(req, cfg, "write");
```

**2b. `/api/notifications/snooze`** — `server.ts:354-357`:

```ts
      if (pathname === "/api/notifications/snooze" && req.method === "POST") {
        // Write-level: snooze is BRIDGE-WIDE (.adr/0003), so one read-only device muting itself
        // mutes the operator's phone too. Silencing every alert is damage, which is exactly what the
        // device gate bounds (issue #8).
        const denied = guard(req, cfg, "write");
```

**2c. `/api/notifications/prefs`** — `server.ts:378-388`. Split the comment so the GET/POST asymmetry
is stated, not inferred:

```ts
      if (pathname === "/api/notifications/prefs") {
        // Which agent statuses push, bridge-wide. Reading them discloses nothing and changes
        // nothing, so GET stays read-level; POST is a write, like snooze — {"blocked":false,
        // "done":false,"updates":false} silences every alert for every device (issue #8).
        if (req.method === "GET") {
          const denied = guard(req, cfg, "read");
          ...
        }
        if (req.method === "POST") {
          const denied = guard(req, cfg, "write");
```

**2d. Also harden the snooze body parse** at `server.ts:366-367`. `typeof until === "number"` admits
`NaN` and `Infinity`; `Infinity` currently survives `set()` and serialises to `null`. Change to:

```ts
        const until = (body as { snoozedUntil?: unknown }).snoozedUntil;
        // Reject NaN/Infinity here so a nonsense deadline is a 400, not a silent clamp.
        if (until !== null && (typeof until !== "number" || !Number.isFinite(until)))
          return text("bad snoozedUntil", 400);
```

**2e. Update the `/api/update/check` comment** (`server.ts:407-411`) to stop crediting the in-flight
guard with protection it doesn't provide:

```ts
      if (pathname === "/api/update/check" && req.method === "POST") {
        // Force an immediate upstream check (the "check for updates" button) instead of waiting for
        // the periodic timer. Still read-level — a version check isn't operator-visible state — but
        // the monitor now enforces a minimum interval between upstream fetches (update.ts), because
        // the in-flight guard only coalesces CONCURRENT calls: a sequential loop was one anonymous
        // GitHub request each, against a 60/hr limit (issue #8). A throttled call is a no-op that
        // returns the last known status.
        const denied = guard(req, cfg, "read");
```

## Change 3 — cap the snooze deadline (`bridge/snooze.ts`)

The cap belongs in the store, not the route, so every caller (and every value already on disk) is
covered.

**3a. Add the constant and a pure clamp** above the class:

```ts
/**
 * Longest a snooze may run. A snooze is "back in a bit", not an off-switch: `snoozedUntil: 9e15` was
 * accepted and persisted, muting every push forever with nothing in the UI ever saying so (issue
 * #8). Seven days is comfortably longer than any real quiet-hours window and short enough that a
 * forgotten snooze self-heals.
 */
export const MAX_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Clamp a requested deadline: null / non-finite / already-past resumes immediately, anything beyond
 * {@link MAX_SNOOZE_MS} from `now` is trimmed back to the cap. Pure + exported so the boundary is
 * unit-tested without touching disk.
 */
export function clampSnooze(mutedUntil: number | null, now: number): number | null {
  if (mutedUntil === null || !Number.isFinite(mutedUntil) || mutedUntil <= now) return null;
  return Math.min(mutedUntil, now + MAX_SNOOZE_MS);
}
```

**3b. Use it in `set()`** (replacing the coercion at `snooze.ts:43`):

```ts
  async set(mutedUntil: number | null): Promise<void> {
    this.mutedUntil = clampSnooze(mutedUntil, this.now());
```

**3c. Use it in `load()`** (`snooze.ts:24-25`) — a file written by an older build, or by hand, must
not outlive the cap either:

```ts
      const raw = (await Bun.file(this.file).json()) as { mutedUntil?: unknown };
      // Clamped on the way in as well as the way out: an uncapped value persisted by an earlier
      // build would otherwise survive every restart.
      this.mutedUntil =
        typeof raw.mutedUntil === "number" ? clampSnooze(raw.mutedUntil, this.now()) : null;
```

`until()` and `isMuted()` need no change.

## Change 4 — rate-limit the upstream release check (`bridge/update.ts`)

Mirror the existing `STALE_TTL_MS` pattern (`update.ts:252-258`) — same injected clock, same
`Number.NEGATIVE_INFINITY` sentinel so the first check always runs.

**4a. Add the constant** next to `TAGS_TIMEOUT_MS` / `STALE_TTL_MS` (`update.ts:26-29`):

```ts
/**
 * Minimum gap between upstream release checks, whoever asks. The in-flight guard below only
 * COALESCES concurrent calls — once a fetch settles the next call fetches again — so a client
 * looping `POST /api/update/check` was one anonymous GitHub request per POST, against a 60/hr limit
 * that the real 6-hourly check shares (issue #8). Counted from the ATTEMPT, not the success, so a
 * failing upstream can't be retried in a tight loop either.
 */
export const CHECK_MIN_INTERVAL_MS = 60_000;
```

**4b. Add the field** alongside the other private fields (`update.ts:203-207`):

```ts
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
```

**4c. Gate `checkRelease()`** (`update.ts:216-222`):

```ts
  checkRelease(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const now = this.deps.now();
    // Sentinel start means the first check is never throttled. The 6-hourly timer in index.ts is
    // far outside this window, so only the on-demand endpoint is ever affected.
    if (now - this.lastAttemptAt < CHECK_MIN_INTERVAL_MS) return Promise.resolve();
    this.lastAttemptAt = now;
    this.inFlight = this.runCheck().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
```

Also amend the file-header note at `update.ts:12-13` ("the 60/hr anonymous limit is irrelevant at a
few-hours cadence") — that reasoning held for the timer, not for an operator-triggered endpoint. Add:
`— the on-demand endpoint is what makes the limit reachable, so checkRelease() enforces
CHECK_MIN_INTERVAL_MS.`

## Change 5 — bridge tests

House style, from `bridge/server.test.ts`: `import { describe, expect, test } from "bun:test"`, a
prose comment above each security `describe` saying why the block exists, `toEqual({ ok: true })` /
`toEqual({ ok: false, reason: "…" })` for `checkAccess`, `toBeNull()` / `expect(denied!.status)
.toBe(403)` for `guard`.

**5a. Extend the `req()` fixture** (`server.test.ts:33-39`) so a test can name a method. Existing
call sites are unaffected:

```ts
function req(headers: Record<string, string>, method = "GET"): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    method,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
  } as unknown as Request;
}
```

**5b. Rename the describe at `server.test.ts:246`** from `"checkAccess — Origin required for writes"`
to `"checkAccess — Origin required for anything state-changing"`, keep its four existing tests, and
add:

```ts
  // Issue #8: the Origin fallback used to key off the access level alone, so a read-level POST from
  // a remote Host with no Origin at all sailed through — the exact non-browser shape the rule
  // exists to refuse. The method is now part of the question.
  test("a read-level POST with no Origin from a non-loopback Host is rejected (issue #8)", () => {
    expect(checkAccess(req({ host: "collie.ts.net" }, "POST"), cfg(), "read")).toEqual({
      ok: false,
      reason: "origin required",
    });
  });

  test("a read-level POST with no Origin from loopback is allowed (curl on the host)", () => {
    expect(checkAccess(req({ host: "127.0.0.1:8787" }, "POST"), cfg(), "read")).toEqual({ ok: true });
  });

  test("a read-level POST WITH a matching Origin passes (the settings page)", () => {
    expect(
      checkAccess(
        req({ host: "collie.ts.net", origin: "https://collie.ts.net" }, "POST"),
        cfg(),
        "read",
      ),
    ).toEqual({ ok: true });
  });

  test("a GET with no Origin still passes — browsers omit it on same-origin reads", () => {
    expect(checkAccess(req({ host: "collie.ts.net" }, "GET"), cfg(), "read")).toEqual({ ok: true });
  });
```

**5c. Add a direct block for the helper** (next to `isHostAllowed`'s at line 273):

```ts
describe("isStateChangingMethod", () => {
  test("GET and HEAD are reads; everything else changes state", () => {
    expect(isStateChangingMethod(req({}, "GET"))).toBe(false);
    expect(isStateChangingMethod(req({}, "head"))).toBe(false);
    expect(isStateChangingMethod(req({}, "POST"))).toBe(true);
    expect(isStateChangingMethod(req({}, "delete"))).toBe(true);
  });

  test("a request with no method reads as GET (the header-only test stub)", () => {
    expect(isStateChangingMethod({ headers: { get: () => null } } as unknown as Request)).toBe(false);
  });
});
```

Add `isStateChangingMethod` to the file's import from `./server.ts`.

**5d. Update the sign-off comment** at `server.test.ts:806-812`. It currently says a header-less
caller keeps read access and that tightening it "should be a deliberate change with this test
updated, not an accident". The test itself (`read` with no device header proceeds) still holds and
stays — append to the comment:

```ts
  // Tightened deliberately in issue #8: snooze, notification prefs (POST) and push subscribe are
  // now guarded as "write", so a read-only device can watch and read its prefs but can no longer
  // silence the herd for everyone. Pane reads, history and the snapshot are unchanged.
```

**5e. `bridge/snooze.test.ts`** — copy the file's existing `tempCfg()` + injected-clock pattern
(second constructor arg, a `() => number` over a mutable `let now`). Add:

```ts
test("a deadline beyond the cap is clamped to MAX_SNOOZE_MS (issue #8)", async () => {
  let now = 1_000;
  const snooze = new Snooze(await tempCfg(), () => now);
  await snooze.set(9e15); // "mute forever"
  expect(snooze.until()).toBe(now + MAX_SNOOZE_MS);
});

test("a deadline inside the cap is kept exactly", async () => {
  let now = 1_000;
  const snooze = new Snooze(await tempCfg(), () => now);
  await snooze.set(now + 60_000);
  expect(snooze.until()).toBe(now + 60_000);
});

test("an uncapped value already on disk is clamped on load", async () => {
  const cfg = await tempCfg();
  await mkdir(cfg.stateDir, { recursive: true });
  await writeFile(join(cfg.stateDir, "snooze.json"), JSON.stringify({ mutedUntil: 9e15 }));
  let now = 5_000;
  const snooze = new Snooze(cfg, () => now);
  await snooze.load();
  expect(snooze.until()).toBe(now + MAX_SNOOZE_MS);
});
```

Plus a `clampSnooze` unit block for the null / past / `NaN` / `Infinity` cases. Import `mkdir` and
`writeFile` from `node:fs/promises` as `notify-prefs.test.ts` already does for its partial-file test.

**5f. `bridge/update.test.ts`** — the existing concurrency test at lines ~172-193 asserts the
*opposite* of a cooldown (`await monitor.checkRelease(); expect(calls).toBe(2)`). It must now tick
past the window first:

```ts
  tick(CHECK_MIN_INTERVAL_MS);
  await monitor.checkRelease(); // in-flight guard cleared AND the cooldown elapsed → fetches afresh
  expect(calls).toBe(2);
```

Add two tests using the existing `makeMonitor({ fetchTags })` + `tick` handles:

```ts
it("a second check inside the minimum interval does not hit upstream (issue #8)", async () => { … expect(calls).toBe(1) });
it("a check after the minimum interval hits upstream again", async () => { … tick(CHECK_MIN_INTERVAL_MS); … expect(calls).toBe(2) });
```

Also add one test that a **failed** check still consumes the window (`fetchTags` throws, immediate
retry does not fetch) — that is the point of stamping the attempt rather than the success.

## Change 6 — the web app stops failing silently (`web/`)

Once the three routes are writes, a read-only device gets 403s. Today that is invisible or, worse,
mis-reported. Fix the reporting first, then hide the controls.

**6a. `web/src/lib/push.ts` — a refused subscribe is not a success.** Lines 147-157 return
`{ ok: true }` regardless of the response, so the settings switch flips on after a 403. Widen the
failure reason and return it:

```ts
/** Why enabling push failed. "refused" is the bridge saying no — a device that isn't allow-listed
 *  can't register for the operator's push stream (issue #8). */
export type EnableFailure = Exclude<PushAvailability, "ready"> | "refused";

export interface EnableResult {
  ok: boolean;
  reason?: EnableFailure;
}
```

and at the fetch:

```ts
  if (!res.ok) return { ok: false, reason: res.status === 403 ? "refused" : "server-off" };
  rememberEndpoint(body.endpoint);
  setUserDisabled(false);
  return { ok: true };
```

Note the behaviour change: `setUserDisabled(false)` now runs only on success, which is correct — a
refused attempt must not be recorded as "the user turned push on".

In `web/src/routes/settings.tsx`, widen `reasonText`'s parameter to `EnableFailure | undefined` and
add the case:

```ts
    case "refused":
      return "This device isn't authorised to change notification settings.";
```

Leave `availabilityNote` (which takes `PushAvailability`) alone.

**6b. `web/src/components/snooze-control.tsx` — surface the failure.** `apply()` has `try/finally`
with no `catch`, so a 403 is an unhandled rejection. Add a `readOnly` prop and a catch:

```ts
export function SnoozeControl({
  snoozedUntil,
  readOnly = false,
}: { snoozedUntil: number | null; readOnly?: boolean }) {
```

```ts
    try {
      await setSnooze(next);
      revalidator.revalidate();
    } catch (err) {
      setStatus(
        isApiErrorStatus(err, 403)
          ? "Read-only — this device isn't authorised to change notification settings"
          : "Couldn't change do not disturb",
        "error",
      );
    } finally {
      setBusy(false);
    }
```

(`setStatus` from `@/lib/status`, `isApiErrorStatus` from `@/lib/api` — the same predicate
`loaders.ts` uses.) Disable the preset/resume buttons with `disabled={busy || readOnly}` and, when
`readOnly`, replace the card's description line with
`"Read-only — this device isn't authorised to change notification settings."`

**6c. `web/src/hooks/use-notify-prefs.ts` + `notify-prefs-control.tsx`.** The hook already reverts
the optimistic toggle on error (`:29-31`); add a `setStatus(…, "error")` there with the same
403-vs-generic split. Give `NotifyPrefsControl` a `readOnly?: boolean` prop that disables the three
switches and shows the same one-line note.

**6d. `web/src/routes/settings.tsx` — wire it.** `root` is already read at `:32`:

```ts
  const readOnly = isReadOnly(root?.device); // from "@/lib/types"
```

Pass `readOnly` to `<NotifyPrefsControl />` and `<SnoozeControl />` (`:129-130`), and disable the
push `Switch` (`:98-103`) when `readOnly`, with `reasonText("refused")` as its note. Leave
`<UpdateCheckControl />` enabled — that route is still read-level.

**6e. Web tests** (Vitest + jsdom + Testing Library; follow each file's existing style):

- `web/src/components/snooze-control.test.tsx` — with `readOnly`, the preset buttons are disabled and
  the read-only note renders; without it, clicking a preset still calls the API.
- `web/src/components/notify-prefs-control.test.tsx` — with `readOnly`, the switches are disabled.
- `web/src/lib/push.test.ts` — a 403 from `/api/subscribe` returns `{ ok: false, reason: "refused" }`,
  does **not** remember the endpoint, and does **not** clear the user-disabled flag.

## Change 7 — docs

The docs currently define "read-only" by a **closed** enumeration of the write set. Each of these
becomes wrong; fix the wording, don't just append.

| File:line | What to do |
|---|---|
| `README.md:549-553` | The load-bearing one. Change "the gate covers writes (replies, keys, uploads, pane and tab create/close)" to "the gate covers writes: replies, keys, uploads, pane and tab create/close, and the bridge-wide notification settings (do-not-disturb, which statuses push, and registering a device for push)". Keep the rest — reads really are still open. |
| `README.md:103-105` | Keep "bounds damage, not disclosure", but note that silencing alerts now counts as damage and is gated. |
| `README.md:135-138`, `539-542` | "only allowlisted devices can drive agents" → "…can drive agents or change notification settings". |
| `README.md:606-610` | Empty-allowlist fail-closed paragraph: add that notification settings are also frozen in that state, so recovery (an `.env` edit + restart) matters more. |
| `README.md:775-778`, `800-802` | "watch but never drive" → "watch, but never drive or change notification settings". |
| `README.md:111-113` | Audit-log sentence — change "Every write action" to "Every terminal action (replies, keys, uploads, pane/tab create/close)", so promoting the settings routes doesn't imply they are audited. |
| `ARCHITECTURE.md:198-204` | "it gates writes and only writes, so that uid keeps reading snapshots, pane output and transcript history" → keep the reading list, and add that since issue #8 the write set includes the bridge-wide notification settings, because a read-only device muting the herd was damage the gate was supposed to bound. |
| `ARCHITECTURE.md:216-220` | Add one clause noting the same extension. |

Also mention the 7-day snooze cap and the 60 s update-check floor wherever those behaviours are
described (search README for `snooze` and `check for updates`); if there is no such passage, a line
in the ARCHITECTURE notifications section is enough.

**ADR 0012** — `.adr/0012-notification-settings-are-writes.md`, Nygard format (Context / Decision /
Consequences), status `Accepted`, dated the day it lands. It clears the `.adr/README.md` bar because
the code itself argued the other way — the comments being deleted in *Change 2* say "registering for
push isn't terminal-driving, so a read-only device may still subscribe". Content:

- **Context.** The device gate was scoped to terminal-driving actions. Snooze and notify-prefs are
  bridge-wide (`.adr/0003`), so one unallowlisted device silences every device; a push subscription
  is a standing grant to receive the operator's alerts. Neither types into a terminal.
- **Decision.** Snooze, notify-prefs POST and subscribe are guarded as `"write"`. Prefs GET and
  update/check stay read-level; update/check is bounded by a cooldown instead. No third "settings"
  level — it would carry no behaviour the write level doesn't already have.
- **Consequences.** Breaking *only* where `COLLIE_DEVICE_HEADER` is set: a read-only device can no
  longer snooze, change alert kinds, or register for push, and the settings page now says so. The
  loopback URL that bypasses the proxy is affected the same way. These routes stay out of
  `audit.log` — that file records what was typed into a terminal.

Add the ADR to the index in `.adr/README.md` in the same shape as 0011.

## Change 8 — restore the missing request file

`requests/issue-8-read-level-posts.md` — the ADW input for this run — does not exist, though issues
#1 and #5 have theirs. Create it from the issue body so the record matches (title line
`# Issue #8 — Low: read-level POSTs (snooze, prefs, subscribe, update/check) change state and can
silence alerts`, then the `## What` and `## Fix` sections verbatim from
`gh issue view 8 --repo bartholomewtj/collie`). Commit it with the functional change, as commit
`5e94351` did for issue #5.

---

## Verify

Run from the repo root. **Judge each command by its exit status.**

```bash
bun test bridge/server.test.ts bridge/snooze.test.ts bridge/update.test.ts   # the files you touched
bun test ./bridge                                                            # whole backend suite
cd web && bun run test && cd ..                                              # Vitest
bun run build                                                                # typechecks BOTH sides
```

**Windows caveat:** `bun test ./bridge` fails ~39 tests on Windows for unrelated POSIX reasons
(`/srv/...` paths, chmod, unix sockets) — see `NEXT-SESSION.md`. Do not chase those. The bar is: the
three files you touched are green, and the failure count elsewhere is unchanged from the baseline
(capture it before you start).

Manual smoke, if a bridge is running (Linux host):

```bash
# read-level POST with no Origin from a remote Host → 403 "origin required"
curl -si -X POST -H 'Host: collie.example.ts.net' -H 'content-type: application/json' \
  -d '{}' http://127.0.0.1:8787/api/update/check | head -1

# an absurd snooze is clamped, not honoured
curl -s -X POST -H 'content-type: application/json' -d '{"snoozedUntil":9e15}' \
  http://127.0.0.1:8787/api/notifications/snooze     # → snoozedUntil ≈ now + 7 days

# two update checks in a row → one upstream fetch (second returns the same checkedAt)
```

## Versioning — bump nothing

`origin` is `bartholomewtj/collie`, `upstream` is `AltanS/collie`, so this is a **fork PR**. Per
`CLAUDE.md` → *Versioning*, leave `herdr-plugin.toml`, `package.json`, `web/package.json` and
`CHANGELOG.md` **exactly as they are** — all four agree on `0.29.0` and `scripts/check-version.sh`
stays green. Every fork commit so far has done the same.

The pre-commit hook will object because `bridge/` and `web/src/` changed. Commit with
`SKIP_VERSION_CHECK=1 git commit …`, the documented escape hatch for exactly this case.

Put the proposed CHANGELOG line in the PR description instead, in the repo's house style:

> **Breaking, only if `COLLIE_DEVICE_HEADER` is set:** notification settings are writes — snooze,
> alert kinds and push subscription now need an allow-listed device, so a read-only device can no
> longer silence the herd for everyone; an Origin header is required on every state-changing request
> whatever its access level; `snoozedUntil` is capped at 7 days; and the upstream release check is
> limited to one fetch per 60 s (#8)

## Branch, commits and PR

Branch `fix/8-read-level-posts` off `main`. Follow the fork's commit shape — the spec commit is
already separate, so land the functional work as one commit:

```
Gate notification settings behind the device gate and bound the update check
```

Then open the PR with `gh pr create` referencing `Fixes #8`. Because this changes operator-visible
behaviour on a deployment that has the device gate on, the PR body must call out:

1. Which routes moved to write level, and which deliberately did not (prefs GET, update/check) and why.
2. That the change is breaking only when `COLLIE_DEVICE_HEADER` is set, and what a read-only device
   loses (nothing it can read; only the three settings actions).
3. The 7-day snooze cap and the 60 s update-check floor.
4. A pointer to ADR 0012, so a reviewer reads the omission of a third "settings" level as a decision
   rather than an oversight.
