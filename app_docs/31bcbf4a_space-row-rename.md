# Spaces Page: Tap-and-Hold Space Row Rename

## Summary

Added tap-and-hold (long-press) interaction to space rows on the Spaces overview page (`/spaces`), allowing users to rename spaces via a dedicated `SpaceActionsSheet`. The implementation mirrors the existing tab rename pattern end-to-end across the web client, bridge API, and Herdr client, with workspace renames restricted to non-empty string labels and no destructive actions (no close/delete).

## Context & Motivation

Previously, tabs and panes supported long-press action sheets for renaming and closing, while rows on the Spaces overview (`web/src/components/space-overview.tsx`) only supported standard navigation taps. Herdr supports workspace renaming via the `workspace.rename { workspace_id, label }` RPC and emits `workspace_renamed` events. This change exposes that capability in the UI with the same touch interactions, guards, and validation as tab renames.

## Changes Made

### 1. Bridge & Backend (`bridge/`)
- **`bridge/herdr-client.ts`**:
  - Added `renameWorkspace(workspaceId: string, label: string): Promise<void>`, invoking the `workspace.rename` RPC with `{ workspace_id, label }`.
- **`bridge/server.ts`**:
  - Extracted and renamed `normalizeTabLabel` into `normalizeLabel` to share validation logic across tab and workspace renames (requires a non-empty string after trimming; rejects empty or non-string inputs).
  - Added route regex `WORKSPACE_ACTION_ROUTE` (`/^\/api\/workspace\/([^/]+)\/(rename)$/`).
  - Added `POST /api/workspace/:id/rename` handler guarded with `guard(req, cfg, "write")` and `deviceAuth`.
  - Added `renameWorkspace` handler to validate request bodies with `normalizeLabel`, invoke `herdr.renameWorkspace`, record an audit entry (`workspace.rename`), and return an `ActionResponse`.
- **`bridge/server.test.ts`**:
  - Renamed test suite from `normalizeTabLabel` to `normalizeLabel` and verified validation behavior for workspace labels.

### 2. Web Client (`web/`)
- **`web/src/lib/api.ts`**:
  - Added `renameSpace(workspaceId: string, label: string, session?: string): Promise<ActionResponse>`, dispatching a `POST` request to `/api/workspace/:id/rename`.
- **`web/src/components/space-actions-sheet.tsx`**:
  - Created `SpaceActionsSheet`, a bottom sheet component offering a rename-only action workflow (opening on action list, transitioning to `RenameView` on tap, autofocusing the input, disabling save on empty input, and displaying read-only notices when unauthorized).
- **`web/src/components/space-overview.tsx`**:
  - Introduced `SpaceRowButton` wrapping `useLongPress` with mobile touch styles (`select-none`, `[-webkit-touch-callout:none]`, retaining list scrolling).
  - Attached long-press handling exclusively to the main row tap button (leaving sibling lane/trace icon buttons unaffected).
  - Added `readOnly` and `onRenamed` props; instantiated a single `SpaceActionsSheet` for the overview list when `onRenamed` is provided.
- **`web/src/routes/spaces.tsx`**:
  - Passed `session`, `readOnly={isReadOnly(data.device)}`, and `onRenamed={() => revalidator.revalidate()}` via React Router's `useRevalidator`.

### 3. Documentation (`HERDR_API.md`, `README.md`)
- **`HERDR_API.md`**: Updated server function reference to `normalizeLabel`.
- **`README.md`**: Documented that space rows can be long-pressed to rename spaces alongside pane pills and tab chips.

### 4. Tests (`web/src/components/`)
- **`web/src/components/space-actions-sheet.test.tsx`**:
  - Added test suite validating sheet rendering, autofocus, trimmed label submission to `/api/workspace/:id/rename`, disabling save on empty text, error propagation, state resets on close/workspace change, XSS resistance, and read-only behavior.
- **`web/src/components/space-overview.test.tsx`**:
  - Added tests verifying that long-press (`contextmenu`) opens the sheet when `onRenamed` is wired, remains inert when unwired, and plain taps navigate without triggering the sheet.

## Verification

### Automated Tests
Run web tests:
```bash
cd web && bun run test
```

Run web TypeScript check:
```bash
cd web && bunx tsc --noEmit
```

Run bridge tests and root typecheck:
```bash
bun test ./bridge/server.test.ts
bunx tsc --noEmit -p .
```
