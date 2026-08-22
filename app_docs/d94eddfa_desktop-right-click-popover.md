# Desktop Mode Right-Click Popover and 0.56.10 Release

## Overview

This change implements the desktop mode right-click action popover (`specs/desktop-mode-spec.md` §4 "Mouse (phase 3)"), allowing desktop users (`useDesktop().on`) to right-click pane pills and home-tree rows (spaces, tabs, panes) to open action rows inside an anchored popover at the mouse pointer instead of the mobile bottom sheet.

Rather than introducing a separate component family or additional action rows, desktop mode swaps the container: `PaneActionsSheet`, `TabActionsSheet`, and `SpaceActionsSheet` render their identical row definitions inside `ActionPopover` when desktop mode is active. Tap-and-hold timers are skipped under desktop mode while preserving right-click context menu handling, inline renaming, two-step deletion confirmations, and keyboard context menu anchoring.

## Changed Files

- `web/src/hooks/use-long-press.ts`:
  - Added exported `LongPressPoint` interface (`{ x: number; y: number }`) and updated callback signature to `(at: LongPressPoint) => void`.
  - Added `disabled` option to `LongPressOptions` (defaults to `false`): when `true`, skips the `pointerdown` hold timer while keeping `onContextMenu` active and `defaultPrevented`.
  - Added `pointFrom` helper to resolve `{ x, y }` coordinates from pointer events, falling back to `getBoundingClientRect()` (`{ x: rect.left, y: rect.bottom }`) or `{ x: 0, y: 0 }` for keyboard-invoked context menus (Shift+F10 / Menu key).
  - Passes triggering coordinates synchronously to `onLongPress(at)`.
- `web/src/components/ui/sheet.tsx`:
  - Exported `useDialogFocus` helper so popovers and dialogs can manage initial focus and restore previous focus on close.
- `web/src/components/ui/popover.tsx` (new):
  - Implemented `ActionPopover` container (`data-testid="action-popover"`, `role="dialog"`, `tabIndex={-1}`, `aria-labelledby`).
  - Anchors popovers using `useLayoutEffect`, clamping coordinates within window viewport bounds with an 8px margin (falling back to `(8, 8)` for null or zero coordinates).
  - Uses `useDialogFocus` for accessible focus handling on open and restore on dismiss.
  - Listens for `Escape` keydown and capture-phase outside `pointerdown` events to dismiss the popover.
- `web/src/components/pane-actions-sheet.tsx`, `web/src/components/tab-actions-sheet.tsx`, `web/src/components/space-actions-sheet.tsx`:
  - Added optional `anchor?: { x: number; y: number } | null` prop.
  - Factored shared row bodies (`ActionRow`, `DestructiveActionRow`, `RenameView`, read-only notice).
  - Conditionally renders `<ActionPopover>` when `useDesktop().on` is true, falling back to `<BottomSheet>` when false.
- `web/src/components/space-tree.tsx`:
  - Added `sheetAnchor` state to store coordinates from long-press/contextmenu events.
  - Updated `TreeRowButton` to pass `{ disabled: useDesktop().on }` to `useLongPress`.
  - Passed `anchor={sheetAnchor}` to `SpaceActionsSheet`, `TabActionsSheet`, and `PaneActionsSheet`.
- `web/src/components/pane-strip.tsx`:
  - Added `anchor` state in `PaneStrip`, passing `{ disabled: useDesktop().on }` to `useLongPress` in `PanePill` and forwarding `anchor` to `PaneActionsSheet`.
- `web/src/components/agent-card.tsx`, `web/src/components/ui/chip.tsx`:
  - Updated `onLongPress` prop types to `(at: LongPressPoint) => void` and passed `{ disabled: useDesktop().on }` to `useLongPress`.
- `web/src/hooks/use-long-press-desktop.test.tsx` (new):
  - Unit tests verifying `disabled: true` skips the hold timer, verifies `contextmenu` fires with `{ x, y }` and calls `preventDefault()`, verifies repeated right-clicks, tests phone mode hold timer coordinates, and tests keyboard context menu rect fallback.
- `web/src/components/ui/popover.test.tsx` (new):
  - Unit tests verifying closed state, anchor positioning, focus placement, 8px inset fallback, outside click dismissal, and Escape dismissal.
- `web/src/components/pane-actions-sheet-desktop.test.tsx`, `web/src/components/tab-actions-sheet-desktop.test.tsx`, `web/src/components/space-actions-sheet-desktop.test.tsx` (new):
  - Component tests verifying each actions sheet renders `ActionPopover` at the anchor when desktop mode is active and `BottomSheet` when inactive, while preserving rename and Escape handling.
- `CLAUDE.md`:
  - Documented the desktop mode container-swap exception to the in-place action rule.
  - Added `components/ui/popover.tsx` to the architecture map under "Long-press actions".
- `specs/d94eddfa_desktop-right-click-popover.md` (new):
  - Phase 3a design plan and requirements specification.
- `herdr-plugin.toml`, `package.json`, `web/package.json`:
  - Bumped version from `0.56.9` to `0.56.10`.
- `CHANGELOG.md`:
  - Added `[0.56.10]` release entry under `Added`.

## Verification

Run test suites, typecheck, and version validation:

```bash
bash scripts/check-version.sh
bun run typecheck
cd web && bun run test
cd .. && bun run test
```
