# Plan — tap-and-hold a space row to rename the space

## What we're building

A space (Herdr workspace) can be renamed from the Spaces page: hold a row → a bottom sheet opens →
Rename → type → Save. A plain tap still opens the space. **Rename only** — no close/delete of a
space anywhere in this change.

This mirrors the tab rename end to end (`tab-actions-sheet.tsx` + `/api/tab/:id/rename` +
`herdr.renameTab`). Herdr's RPC is `workspace.rename {workspace_id, label}`; `label` is a non-null,
non-empty string, so — exactly like a tab — there is **no "clear"**: a blank label is refused, not a
reset (`HERDR_API.md` lines 163–186).

## Facts already checked (don't re-verify)

- `bridge/event-poker.ts` **already** subscribes to `workspace.renamed` (`GLOBAL_SUBSCRIPTIONS`,
  line 24). **No change needed there.** Do not add anything to that list.
- `bridge/audit.ts` `METADATA_KEYS` already contains `workspaceId`, and does **not** contain `label`
  — same as the existing `tab.rename` audit line. Leave `METADATA_KEYS` alone; the redaction
  behaviour matches the tab rename by construction.
- `SpaceOverview` has exactly one caller: `web/src/routes/spaces.tsx`. Nothing else to thread.
- `web/src/lib/types.ts` already exports `isReadOnly(device)` and `WorkspaceView`.

## Route naming decision (already made — just follow it)

Use **`POST /api/workspace/:id/rename`**. It matches the existing create route (`POST /api/workspace`)
and the RPC name. The create route is an exact-string match on `/api/workspace`, so a
`/api/workspace/<id>/rename` regex cannot collide with it — same shape as the tab pair.

---

## Bridge

### 1. `bridge/herdr-client.ts` — add `renameWorkspace`

Directly below `renameTab` (~line 471):

```ts
/**
 * Set a workspace's label. Like {@link renameTab} and unlike {@link renamePane}, `label` is a
 * NON-null, non-empty string — herdr has no "clear" for a workspace (HERDR_API.md "Rename methods").
 * Resolves on herdr's `workspace_info` reply; the new label surfaces on the next snapshot poll
 * (workspace.rename also emits `workspace_renamed`, which event-poker already subscribes to, so a
 * rename pokes an immediate re-poll). Bad id → `workspace_not_found`.
 */
renameWorkspace(workspaceId: string, label: string): Promise<void> {
  return this.request<void>("workspace.rename", { workspace_id: workspaceId, label });
}
```

### 2. `bridge/server.ts` — share the label rule, add the route

**a. Rename the shared validator.** `normalizeTabLabel` (line ~1014) becomes `normalizeLabel` and is
used by **both** rename handlers — do not copy it. Update its doc comment to say it covers tab *and*
workspace labels (both non-null, non-empty; only `pane.rename` has a clear, via `null`). Update the
call site inside `renameTab`, the import + `describe` block + assertions in `bridge/server.test.ts`,
and any other reference (`grep -rn normalizeTabLabel`).

**b. Add the handler**, next to `renameTab`.

Route constant beside `TAB_ACTION_ROUTE` (~line 123), with a one-line comment noting the exact-match
`/api/workspace` create POST cannot collide with it:

```ts
const WORKSPACE_ACTION_ROUTE = /^\/api\/workspace\/([^/]+)\/(rename)$/;
```

```ts
// Set a workspace's label. Structural metadata op — same threat model as tab.rename, so the same
// write guard. A workspace has no "clear" (see normalizeLabel): a blank label is a 400.
async function renameWorkspace(
  herdr: HerdrClient,
  workspaceId: string,
  req: Request,
  audit: AuditLog,
  device: string | null,
  session: string,
): Promise<Response> {
  const bad = requireJsonBody(req);
  if (bad) return bad;
  const ae = req.headers.get("accept-encoding");
  let body: { label?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return text("bad body", 400);
  }
  const parsed = normalizeLabel(body.label);
  if (!parsed.ok) return text(parsed.error, 400);
  try {
    await herdr.renameWorkspace(workspaceId, parsed.label);
    audit.record({
      action: "workspace.rename",
      session,
      device,
      detail: { workspaceId, label: parsed.label },
    });
    return json({ ok: true } satisfies ActionResponse, ae);
  } catch (err) {
    return json({ ok: false, error: failureText("rename space", err) } satisfies ActionResponse, ae);
  }
}
```

**c. Wire it** in the router, immediately after the `TAB_ACTION_ROUTE` block (~line 307) — guarded
identically to the tab route:

```ts
// ── Space (workspace) actions: rename (set its label). No close — Collie doesn't delete spaces. ──
const wsMatch = pathname.match(WORKSPACE_ACTION_ROUTE);
if (wsMatch && req.method === "POST") {
  const denied = guard(req, cfg, "write");
  if (denied) return denied;
  const rt = registry.get(sessionName);
  if (!rt) return unknownSession();
  const workspaceId = decodePathSegment(wsMatch[1]!);
  if (workspaceId === null) return text("bad workspace id", 400);
  return renameWorkspace(rt.herdr, workspaceId, req, audit, deviceAuth(req, cfg).device, rt.name);
}
```

Order matters only in that the exact-match `/api/workspace` create block must stay **above** this
one (it already is).

### 3. Bridge tests — `bridge/server.test.ts`

Pure parts only (`bun test` at the root; the `Bun.serve` handler stays untested by convention):

- Rename the existing `normalizeTabLabel` describe to `normalizeLabel`, keeping all six assertions,
  and reword the comment to "a tab **or space** label is a non-null, non-empty string".
- Add one case naming both callers, e.g. `normalizeLabel("  my space  ")` →
  `{ok: true, label: "my space"}`, with a comment that this is the rule the workspace route uses.
  Don't build a fake `Request`/`HerdrClient` harness for the handler.

---

## Web

### 4. `web/src/lib/api.ts` — `renameSpace`

Directly after `renameTab` (~line 370):

```ts
/** Set a space's (workspace's) label. Non-empty required — like a tab, a space has no "clear". */
export function renameSpace(
  workspaceId: string,
  label: string,
  session?: string,
): Promise<ActionResponse> {
  return req<ActionResponse>(
    withSession(`/api/workspace/${encodeURIComponent(workspaceId)}/rename`, session),
    { method: "POST", body: JSON.stringify({ label }) },
  );
}
```

### 5. New `web/src/components/space-actions-sheet.tsx`

A trimmed copy of `tab-actions-sheet.tsx` — **Rename only**, no `DestructiveActionRow`, no
`usePendingConfirm`, no `onClosed`.

Props:

```ts
interface SpaceActionsSheetProps {
  open: boolean;
  onClose: () => void;
  /** The space these actions target. Null while nothing is selected (sheet closed). */
  workspace: WorkspaceView | null;
  /** Session scope for the rename write (undefined = primary). */
  session?: string;
  /** This device isn't authorised to write — show a read-only note instead of the actions. */
  readOnly?: boolean;
  /** Fired after a successful rename so the parent can revalidate. */
  onRenamed: () => void;
}
```

Behaviour, identical to the tab sheet:

- `mode: "actions" | "rename"`, starting on `"actions"` with a single `ActionRow`
  (`<Pencil className="size-4 shrink-0 text-muted-foreground" />`, label `"Rename"`).
- Reset effect keyed on `[open, workspace?.workspaceId]`: `setMode("actions")`, and when open
  `setLabel(workspace?.label ?? "")`. Keep the same eslint-disable line; deliberately not keyed on
  the live label, so a background poll can't clobber a mid-edit field.
- Autofocus effect: `if (mode === "rename") inputRef.current?.focus()`.
- `save()` → `api.renameSpace(workspace.workspaceId, trimmed, session)`; on `ok` →
  `setStatus("Renamed", "success")`, `onRenamed()`, `onClose()`; on `!ok` →
  `setStatus(res.error ?? "Rename failed", "error")` and stay open; `catch` → `setStatus(message,
  "error")`; `finally setSaving(false)`.
- Render `<RenameView … canSave={!!trimmed} placeholder="name this space" />` — blank can't be saved.
- Sheet title: `` workspace ? `Space ${workspace.label}` : "Space" ``.
- Read-only branch replaces the actions with
  `Read-only — this device isn't authorised to rename spaces.` (same `<p>` classes as the tab sheet).
- Header comment: it is the tab sheet minus the destructive row (Collie deliberately offers no space
  close/delete); a space has no "clear" so a blank label can't be saved; the label is rendered only
  as an `<input>` value / text node — never markup.

Reuse `BottomSheet`, `ActionRow`, `RenameView`. **No new UI primitives, no changes to
`action-sheet-rows.tsx`.**

### 6. `web/src/components/space-overview.tsx` — long-press a row

**Hook placement matters.** The rows are produced inside `visible.map(...)`, so `useLongPress`
cannot be called there. Extract the row's existing main tap-target `<button>` into a small component
in the same file (mirror `TabHeading` in `space-view.tsx`):

```tsx
function SpaceRowButton({
  onOpen,
  onLongPress,
  children,
}: {
  onOpen: () => void;
  onLongPress?: () => void;
  children: ReactNode;
}) {
  const longPress = useLongPress(onLongPress);
  return (
    <button
      type="button"
      onClick={onOpen}
      {...longPress}
      // select-none + -webkit-touch-callout:none stop iOS Safari's selection loupe, whose native
      // long-press gesture otherwise fires pointercancel and kills the hold timer. Deliberately NO
      // touch-action:none — the spaces list must keep scrolling; a scroll cancels the hold instead.
      className="flex min-w-0 flex-1 select-none flex-row items-center gap-3 text-left transition-transform [-webkit-touch-callout:none] active:scale-[0.99]"
    >
      {children}
    </button>
  );
}
```

Keep the existing children (status dot + sr-only status word, label, pane count, `timeAgo`) exactly
as they are, so the button's accessible name still contains the space label —
`space-overview.test.tsx` already finds rows by `getByRole("button", { name: /anchorgenius/ })`.
**Do not add an `aria-label`.**

Attach the long-press to **this row button only**, never the lanes/traces icon (it is a sibling
button and stays a plain tap).

New props on `SpaceOverviewProps`, documented in the same voice as `TabStrip`'s:

```ts
/** Drop the long-press rename when the device isn't authorised (the sheet shows a note). */
readOnly?: boolean;
/** Revalidate after a rename. The long-press space actions turn on only when this is set. */
onRenamed?: () => void;
```

In the component body:

```ts
const [sheetSpace, setSheetSpace] = useState<WorkspaceView | null>(null);
// Inert without the callback — same pattern as TabStrip.actionsEnabled.
const actionsEnabled = !!onRenamed;
```

Per row: `onLongPress={actionsEnabled ? () => setSheetSpace(w) : undefined}`.

One sheet instance for the whole section, rendered after the list (inside the returned `<section>`,
guarded by `actionsEnabled`):

```tsx
{actionsEnabled && (
  <SpaceActionsSheet
    open={sheetSpace !== null}
    onClose={() => setSheetSpace(null)}
    workspace={sheetSpace}
    session={session}
    readOnly={readOnly}
    onRenamed={onRenamed}
  />
)}
```

There is **no `onTapActive` equivalent** here: a plain tap on a space row already means "open the
space", so the only way in is the hold (or right-click / Android `contextmenu`, which the hook
already handles).

### 7. `web/src/routes/spaces.tsx` — thread the callbacks

Add `useRevalidator` to the `react-router` import and `isReadOnly` to the `@/lib/types` import
(follow `web/src/routes/space.tsx` lines 27, 87–89):

```tsx
const revalidator = useRevalidator();
…
<SpaceOverview
  …
  session={data.session}
  readOnly={isReadOnly(data.device)}
  onRenamed={() => revalidator.revalidate()}
/>
```

### 8. `README.md` — one line

Line 57 currently reads:

```
into a space's tabs and panes (long-press a pane pill or a tab chip to rename or close it —
```

Change it so a space row is included, rename-only, e.g.:

```
into a space's tabs and panes (long-press a pane pill or a tab chip to rename or close it, or a
space row to rename the space —
```

Keep the rest of the sentence intact. Doc-only.

---

## Tests

### 9. New `web/src/components/space-actions-sheet.test.tsx`

Model on `tab-actions-sheet.test.tsx` (MSW + Testing Library), dropping every close-related test:

- opens on the action list (a `Rename` button, no `name this space` input yet, and **no** close row
  of any kind);
- Rename tap shows the prefilled input; autofocus; Back returns to the list without saving;
- posts the trimmed label → body `{ label: "api" }`, URL contains `/api/workspace/w1/rename` (use an
  id needing no encoding, or assert the encoded form if you use a `:`), `onRenamed` once, `onClose`
  once;
- Save disabled on a blank field (a space has no clear);
- failure (`{ok: false, error: "workspace not found"}`) → no `onRenamed`, no `onClose`;
- resets to the action list when the sheet reopens and when the target workspace changes;
- a markup-looking label renders as literal text (no `<img>` in the document);
- `readOnly` → the read-only note, no `Rename` button, no input, no `Save`.

Use a local `ws(...)` helper returning a `WorkspaceView` (copy the one in `space-overview.test.tsx`).

### 10. `web/src/components/space-overview.test.tsx` — add a `describe`

Follow `tab-strip.test.tsx` "long-press actions": `fireEvent.contextMenu` is the long-press stand-in
(no fake timers needed — the contextmenu path fires the hook directly).

```tsx
describe("SpaceOverview — long-press rename", () => {
  it("opens the space actions sheet on a long-press when onRenamed is wired", () => { … });
  it("stays inert on contextmenu when onRenamed is not wired", () => { … });
  it("still opens the space on a plain tap, without opening the sheet", async () => { … });
});
```

Assert the sheet by `screen.getByRole("button", { name: "Rename" })` and that it names the right
space (its title contains that row's label). For the inert case, `queryByRole(…, "Rename")` is null.
For the plain tap, `onOpen` is called once **and** no `Rename` button appears.

### 11. Commands that must pass

```
cd web && bun run test
cd web && bunx tsc --noEmit
bun test                # root (at minimum: bun test ./bridge/server.test.ts)
bunx tsc --noEmit -p .  # root typecheck
```

Judge each by its exit status, not by words in the output.

---

## Out of scope / traps

- **Do NOT bump the version and do NOT touch `CHANGELOG.md`.** The release commit is cut afterwards.
  The pre-commit hook will object to a functional commit without a bump — if you commit, use
  `SKIP_VERSION_CHECK=1 git commit …`; that is expected here.
- No workspace close/delete, no `workspace.move`, no new dependencies, no new UI primitives.
- Don't touch `bridge/event-poker.ts` (`workspace.renamed` is already subscribed) or
  `bridge/audit.ts` `METADATA_KEYS`.
- Don't loosen any guard: this is a write-level structural op — `guard(req, cfg, "write")` +
  `deviceAuth`, exactly like `tab.rename`.
- Render the label only as text / an `<input value>` — never markup. That's the XSS boundary.
- Don't set `touch-action: none` on the row; the list must keep scrolling.
- The bridge tsconfig allows parameter-property shorthand; `web/` enforces `import type` +
  `erasableSyntaxOnly`. Keep each side consistent with itself (use `import type` for `WorkspaceView`,
  `ReactNode`, etc. in the web files).
