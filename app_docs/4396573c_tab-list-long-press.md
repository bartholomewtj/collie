# Tab List Heading Long-Press Actions (Rename & Close)

## Summary

Enabled long-press interactions on tab section headings within the "All" space view (`SpaceView`), allowing users on mobile and touch devices to rename or close tabs via `TabActionsSheet`, matching the interaction pattern already available on tab strip chips (`TabStrip`).

## Context & Motivation

On the space screen (`web/src/routes/space.tsx`), tab chips in the `TabStrip` header supported long-press gestures to open `TabActionsSheet` (for renaming or closing tabs). However, in the pane list below when "All" was selected, `SpaceView` rendered each tab group as a static `<h3>` heading. Holding down on a heading on mobile did not trigger tab actions and instead prompted browser text-selection loupes or callouts.

## Changes Made

### 1. `web/src/components/space-view.tsx`
- **Props**: Added optional `session`, `readOnly`, `onRenamed`, and `onClosed` props to `SpaceViewProps` to match `TabStripProps`. Actions are enabled when both `onRenamed` and `onClosed` are provided (`actionsEnabled = !!onRenamed && !!onClosed`).
- **`TabHeading` Component**: Introduced a local component that wraps the heading text in an accessible `<button type="button">` with `aria-label={`Tab ${label} actions`}` and handlers spread from `useLongPress(onLongPress)`.
  - Applied `select-none` and `[-webkit-touch-callout:none]` styling to prevent native iOS Safari text selection loupes from canceling pointer events.
  - Omitted `touch-action: none` so vertical scrolling in the space view list remains fluid (scrolling cancels the long-press timer).
  - Plain clicks on the button intentionally perform no action.
- **Tab Lookup & Orphan Handling**: Constructed a `tabById` map (`new Map(tabs.map((t) => [t.tabId, t]))`) to resolve `TabView` instances needed by `TabActionsSheet`. Synthetic orphan groups (which have no matching `TabView` in `tabs`) remain inert headings.
- **Sheet Integration**: Rendered a single `TabActionsSheet` instance per `SpaceView`, controlled by `sheetTab` state (`useState<TabView | null>(null)`).

### 2. `web/src/routes/space.tsx`
- Threaded `session`, `readOnly`, `onRenamed`, and `onClosed` handlers into `<SpaceView>` alongside `<TabStrip>`.
- Preserved fallback logic on tab closure (`if (tab === tabId) setTab(null); revalidator.revalidate()`).

### 3. `web/src/components/space-view.test.tsx`
- Added comprehensive unit tests covering:
  - Default rendering of tab groups in "All" view vs. filtered tab views.
  - Long-press / `contextmenu` event opening `TabActionsSheet` targeting the specific tab.
  - Ensuring single tap / click does not open the sheet.
  - Ensuring headings remain inert plain `<h3>` text when action props are omitted or only partially wired (`onRenamed` or `onClosed` alone).
  - Confirming synthetic orphan groups (`…`) remain inert text.
  - Pointerdown timer-based long-press simulation with fake timers (`vi.advanceTimersByTime(500)`).
  - Full tab closure flow triggering the close API and `onClosed` callback.

## Verification

Run the web test suite:
```bash
cd web && bun run test
```

Run TypeScript validation:
```bash
cd web && bunx tsc --noEmit
```
