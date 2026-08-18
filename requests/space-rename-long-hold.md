# Spaces page: tap-and-hold a space row to rename the space

## What
Panes and tabs can be renamed from a long-press actions sheet (`pane-actions-sheet.tsx`,
`tab-actions-sheet.tsx`). Spaces (Herdr workspaces) cannot — the Spaces page
(`web/src/routes/spaces.tsx` → `web/src/components/space-overview.tsx`) rows only open the space.
Herdr supports it: `workspace.rename {workspace_id, label}` (label is a NON-null, non-empty string;
`workspace_renamed` event) — see `HERDR_API.md` "Renames". Add tap-and-hold → Rename for a space,
end to end, mirroring the tab rename exactly. **Rename only — no close/delete of a space.**

## Fix — bridge (mirror the tab rename, do not invent a new shape)
- `bridge/herdr-client.ts`: add `renameWorkspace(workspaceId, label)` next to `renameTab` calling
  RPC `workspace.rename` with `{ workspace_id, label }`.
- `bridge/server.ts`: a `POST /api/space/:id/rename` route (or `/api/workspace/:id/rename` — pick
  one, use it consistently in `web/src/lib/api.ts`), guarded exactly like the tab route
  (`guard(req, cfg, "write")`, session registry lookup, `decodePathSegment`, `deviceAuth`), body
  `{label}` validated by the same rule as `normalizeTabLabel` (non-string → "bad label", blank after
  trim → "label required"; a workspace has no "clear"). Reuse `normalizeTabLabel` or extract a shared
  `normalizeLabel` used by both — don't copy the function. `audit.record({ action: "workspace.rename",
  … detail: { workspaceId, label } })`. Reply `{ok:true}` / `{ok:false,error}` (`ActionResponse`) like
  `renameTab`.
- If `bridge/event-poker.ts` lists `tab.renamed` as a poke event, add `workspace.renamed` next to it
  (check the event catalog first; the schema names it `workspace_renamed`, note which spelling the
  poker uses for tabs and match that convention).
- Backend unit tests: pure parts only (`bun test` at root, see `bridge/server.test.ts` for how
  `normalizeTabLabel`/route helpers are tested). Don't try to test the Bun.serve handler itself.

## Fix — web
- `web/src/lib/api.ts`: `renameSpace(workspaceId, label, session?)` next to `renameTab`, same
  `withSession` + POST JSON pattern.
- New `web/src/components/space-actions-sheet.tsx`, structurally a copy of `tab-actions-sheet.tsx`
  with only Rename (no destructive row): opens on an action list with a single "Rename" row, then the
  shared `RenameView` from `action-sheet-rows.tsx`; blank label can't be saved; read-only devices get
  the note instead of actions; success → `setStatus`, `onRenamed()`; failure → `setStatus(error,
  "error")`. Reuse `BottomSheet`, `ActionRow`, `RenameView` — no new UI primitives.
- `space-overview.tsx`: each space row gets `useLongPress` (`web/src/hooks/use-long-press.ts`) — read
  its header comment and follow the mobile rules (`select-none` + `[-webkit-touch-callout:none]` on the
  pressed element, spread the handlers, no `touch-action: none`, the list must keep scrolling). A
  long-hold opens `SpaceActionsSheet` for that space; a plain tap still opens the space (the hook
  suppresses the click after a completed hold). One sheet instance per `SpaceOverview` (state: which
  workspace). Actions are wired only when the parent passes `onRenamed` (+ `session`, `readOnly`) —
  same "inert without callbacks" pattern as `TabStrip.actionsEnabled`. Thread `session={data.session}`,
  `readOnly={isReadOnly(data.device)}`, `onRenamed={() => revalidator.revalidate()}` from `SpacesRoute`
  (`useRevalidator` as `space.tsx` does).
- If the row has been restructured by a concurrent change (a lanes/traces icon added as a sibling
  element), attach the long-press to the main row button, not the icon.
- Update `README.md` one line where it says "long-press a pane pill or a tab chip to rename or close
  it" to include a space row (rename only). Doc-only, no version bump.

## Tests
- Web: `space-actions-sheet.test.tsx` (model on `tab-actions-sheet.test.tsx`: rename saves via a
  mocked `api.renameSpace`, blank can't save, read-only shows the note); `space-overview.test.tsx`
  (add to it if it exists): long-press on a row opens the sheet with that space's label; a plain tap
  calls `onOpen` and doesn't open the sheet; no callbacks → no sheet. Use the fake-timer /
  `pointerdown`+`contextmenu` pattern from `tab-strip.test.tsx`.
- `cd web && bun run test`, `cd web && bunx tsc --noEmit`, root `bun test` (or at least
  `bun test ./bridge/server.test.ts`) — all must pass. Root typecheck: `bunx tsc --noEmit -p .`.

## Out of scope
- Do NOT bump the version or edit `CHANGELOG.md` — the release commit is cut afterwards.
- No workspace close/delete, no `workspace.move`, no new dependencies.
- Security: this is a write-level structural op like `tab.rename` (same threat model, same guard).
  Don't loosen any guard, and render the label only as text/`<input value>` — never markup.
