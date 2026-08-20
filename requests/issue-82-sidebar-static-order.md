Stop the spaces list rearranging itself: drop recency sort and the blocked-first regroup from the rendered order; keep a fixed order.

Where: web/src/components/space-tree.tsx (recencySorted + blocked-first regroup at ~103-109), web/src/lib/spaces.ts (sortSpacesByRecency — stop calling it from the tree; do not have to delete the helper), web/src/components/space-tree.test.tsx:245 ("blocked spaces sort first and start expanded by default" — change the sorting half; auto-expand of blocked spaces stays).

Done means: spaces stay in one stable order — the snapshot's existing workspace order (Herdr's order / WorkspaceView.number). No recency jumps, no blocked-first lift. Blocked state still shows in place (existing badge/colour/tint). Query filter still works. A new or updated test asserts a blocked space does NOT move above a non-blocked one that was listed first. Auto-expand of blocked spaces stays (`prefs.spaceOpen[id] ?? blocked`). `cd web && bun run test` passes. PATCH bump 0.45.0 → 0.45.1 in herdr-plugin.toml, package.json, web/package.json, and a CHANGELOG Fixed line.

Out of scope: filter-by-query behaviour, blocked badge/colour visuals, auto-expand of blocked spaces, bridge/, Herdr, sortSpacesByRecency's own unit tests except callers of the tree, adws/, other issues, docs PRs #84/#86.
