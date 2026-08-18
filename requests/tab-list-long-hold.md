# Tab list: long-hold a tab in the space's list to rename or close it (mobile)

## What
On the space screen (`web/src/routes/space.tsx`), the tab **chips** in `TabStrip` already
support long-press → `TabActionsSheet` (Rename / Close tab). The tab **list** below it does not:
when "All" is selected, `web/src/components/space-view.tsx` renders every tab as a section with a
plain `<h3>` heading (`g.label`) over its panes. On a phone, holding that heading does nothing
(or triggers the browser's text-selection / callout). The user wants a long hold on a tab in that
list to open the same rename/close actions the chips have.

## Fix
- In `SpaceView`, make each tab section heading (the per-tab `<h3>` shown when `selectedTab === null`)
  a long-pressable target that opens `TabActionsSheet` for that tab. Reuse `useLongPress`
  (`web/src/hooks/use-long-press.ts`) and `TabActionsSheet` (`web/src/components/tab-actions-sheet.tsx`)
  exactly as `TabStrip` does — do not build a second sheet or a second long-press mechanism.
- Follow the mobile rules already documented in `use-long-press.ts` and `ui/chip.tsx`: the target
  needs `select-none` + `[-webkit-touch-callout:none]`, spreads the hook's handlers, and must not set
  `touch-action: none` (the list has to keep scrolling). Use a `<button type="button">` inside/as the
  heading so it is focusable and gets `aria-label` like "Tab <label> actions"; a plain tap on the
  heading should do nothing destructive (no-op or open the sheet — pick no-op, since a tap on an
  active chip already opens the sheet and this list has no "active" tab).
- Actions are enabled only when the parent wires the same `session`, `readOnly`, `onRenamed`,
  `onClosed` that `TabStrip` receives — thread those props from `space.tsx` into `SpaceView`. When they
  are absent the heading stays a plain heading (same "inert" pattern as `TabStrip.actionsEnabled`).
- On close of the tab currently being viewed, `space.tsx` already falls back to "All" and
  revalidates; keep that behaviour (the list is only shown under "All", so nothing new is needed there
  beyond revalidating).
- One sheet instance per `SpaceView` (state: which tab is targeted), same as `TabStrip`.

## Tests
- Add `web/src/components/space-view.test.tsx` (Vitest + Testing Library, see
  `web/src/components/tab-strip.test.tsx` for the existing long-press test pattern with fake timers /
  `pointerdown` + `contextmenu`): long-press on a tab heading opens the sheet with that tab's label;
  a plain tap does not; with no action props wired, no sheet and no button. Existing
  `tab-strip.test.tsx` and `tab-actions-sheet.test.tsx` must keep passing.
- Run `cd web && bun run test` and the typecheck (`cd web && bunx tsc --noEmit` or `bun run build`
  at the root).

## Out of scope
- Do NOT bump the version or edit `CHANGELOG.md` — the release commit is cut afterwards on the branch.
- Do not touch the bridge, the pane strip, or the swipe-up pane switcher.
- No new dependencies.
