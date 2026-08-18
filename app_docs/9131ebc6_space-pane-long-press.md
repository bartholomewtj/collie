# Space List Pane Row Long-Press Actions (Rename & Close)

## Summary

Enabled tap-and-hold (long-press) gestures on pane rows (`AgentCard`) in the space view (`SpaceView`), allowing users on mobile and touch devices to rename or close individual agent and shell panes via `PaneActionsSheet`, matching the interaction pattern of pane switcher pills (`PaneStrip`).

## Context & Motivation

Inside a space (`/space/:spaceId`), panes are listed as `AgentCard` rows grouped by tab. Previously, tapping a pane opened it, but tap-and-hold was unhandled. Pane pills in `PaneStrip` and tab section headings in `SpaceView` already supported tap-and-hold actions to rename or close their targets. Wiring long-press handling on space list pane rows brings parity to pane management directly from the space view.

## Changes Made

### 1. `web/src/components/agent-card.tsx`
- Added optional `onLongPress?: () => void` prop to `AgentCardProps`.
- Integrated `useLongPress(onLongPress)` hook and spread handlers onto the root `<button>`.
- Conditionally applied `select-none` and `[-webkit-touch-callout:none]` classes when `onLongPress` is wired to prevent iOS Safari selection loupes from canceling hold timers, while deliberately omitting `touch-action: none` to preserve fluid vertical scrolling.
- Left the card unchanged when `onLongPress` is unset, ensuring identical rendering for the herd list (`agent-list.tsx`).

### 2. `web/src/components/space-view.tsx`
- Added optional `onPaneClosed?: () => void` prop to `SpaceViewProps` without overloading the existing tab `onClosed` prop.
- Added `sheetPane` state (`useState<AgentView | null>(null)`) and derived `paneActionsEnabled = !!onRenamed && !!onPaneClosed`.
- Passed `onLongPress` to `AgentCard` for all panes (agent panes and bare shell panes alike) when pane actions are enabled.
- Mounted a single `PaneActionsSheet` instance managed by `sheetPane` state alongside `TabActionsSheet`.

### 3. `web/src/routes/space.tsx`
- Wired `onPaneClosed={() => revalidator.revalidate()}` on `<SpaceView />` to refresh the space when a pane is closed from the sheet.

### 4. `web/src/components/space-view.test.tsx`
- Added test coverage under `SpaceView — long-press pane actions` verifying:
  - Context menu and pointerdown timer-based hold (500ms) open `PaneActionsSheet` for the targeted pane with "Rename" and "Close pane" actions.
  - Plain click invokes `onOpen` and does not open `PaneActionsSheet`.
  - Pane rows remain inert when action props are omitted or partially wired.
  - Bare shell pane rows trigger the same action sheet.
  - Tab heading hold (`TabActionsSheet`) and pane row hold (`PaneActionsSheet`) function alongside each other without collision.

### 5. `specs/9131ebc6_space-pane-long-press.md`
- Added technical specification and test plan for space pane long-press interactions.

## Verification

Run the web test suite:
```bash
cd web && bun run test
```

Run TypeScript validation:
```bash
cd web && bunx tsc --noEmit
```
