Remove the traces icon from the spaces pane. Make the "Filter spaces" search box just an icon in the top panel.

Where: `web/src/components/space-tree.tsx` (spaces pane: `LanesIcon` traces buttons on space rows and tab rows; the "Filter spaces…" search input in the list body; the Spaces `SectionHeader` top panel that already holds New space), `web/src/components/space-tree.test.tsx`.

Done means:
- The spaces pane no longer shows a traces/lanes icon on space rows or tab rows.
- The full "Filter spaces…" search box is gone from the list body.
- Filter is just an icon in the Spaces top panel (the `SectionHeader` trailing area, next to New space). Tapping the icon still lets you filter spaces.
- Existing space-tree tests are updated; `cd web && bun run test` and `cd web && bunx tsc --noEmit` pass.

Out of scope: the traces button in the agent-chat pane header, the traces route, `LanesIcon` in `sssf-frame.tsx` itself (still used elsewhere), bridge/SSSF snapshot, version bump, `CHANGELOG.md`.
