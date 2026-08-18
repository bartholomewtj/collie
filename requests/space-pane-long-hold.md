# Space list view: tap-and-hold a pane row to rename or close it

## What
Inside a space (`web/src/routes/space.tsx` → `web/src/components/space-view.tsx`), the panes are
listed as `AgentCard` rows (`web/src/components/agent-card.tsx`) grouped by tab. Tap opens the pane;
there is no hold. The pane pill in the pane switcher (`pane-strip.tsx`) already has tap-and-hold →
`PaneActionsSheet` (Rename / Close pane, two-tap confirm), and 0.37.0 gave the same gesture to tab
headings and space rows. Make the pane rows in the space list behave the same: **hold → rename /
close that pane**, exactly the pane sheet the pill uses.

## Fix
- `AgentCard` gets an optional `onLongPress?: () => void`. When set, the card's root `<button>`
  spreads `useLongPress(onLongPress)` (`web/src/hooks/use-long-press.ts` — read its header and
  follow it: `select-none` + `[-webkit-touch-callout:none]` on the pressed element, no
  `touch-action: none`, the list must keep scrolling; the hook already suppresses the click after a
  completed hold, so a hold never also opens the pane). Unset → the card is unchanged. Do NOT change
  the card's markup or classes otherwise — it is also used by the home (herd) list via
  `agent-list.tsx`, which must render pixel-identically (no `onLongPress` passed there).
- `SpaceView` gets one `PaneActionsSheet` instance (state: which pane), reusing
  `web/src/components/pane-actions-sheet.tsx` as-is — no new sheet, no new rows. It passes
  `onLongPress={() => setSheetPane(p)}` to each `AgentCard` only when the actions are wired
  (`session`, `readOnly`, `onRenamed`, `onClosed` — `SpaceView` already receives these for the tab
  headings; reuse them, do not add parallel props). Both agent panes and bare shell panes in the list
  get the hold (the pill gives shells the same sheet).
- `PaneActionsSheet.onClosed(paneId)` in this context: revalidate (the pane drops out of the list). If
  `SpaceView`'s existing `onClosed` prop is typed for tabs (`(tabId: string)`), add a separate
  `onPaneClosed?: () => void` prop rather than overloading it — read `space.tsx` and pick the smallest
  change; either way `space.tsx` just calls `revalidator.revalidate()`.
- Keep the tab-heading hold from 0.37.0 working alongside (heading and cards are separate targets).

## Tests
- Extend `web/src/components/space-view.test.tsx` (it already has the fake-timer /
  `pointerdown` + `contextmenu` long-press pattern for headings): a hold on a pane row opens the pane
  sheet showing that pane's name; a plain tap calls `onOpen` and opens no sheet; without the action
  props the card has no long-press behaviour; a shell pane row also gets the sheet.
- Add one case to `agent-card.test.tsx` if it exists (else skip): with no `onLongPress` the render is
  unchanged (snapshot or class assertion).
- `cd web && bun run test`, `cd web && bunx tsc --noEmit` — must pass. Existing
  `pane-strip.test.tsx`, `pane-actions-sheet.test.tsx`, `agent-list` tests keep passing.

## Out of scope
- No version bump, no `CHANGELOG.md` edit — release cut afterwards.
- No bridge changes (pane rename/close routes exist), no new dependencies, no change to the home
  (herd) list, the pane switcher, or the sheet itself.
