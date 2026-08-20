# Fixed Space Order in Spaces Tree

## Overview

The spaces list in the home tree (`/`) now renders spaces in a fixed, stable order matching Herdr's snapshot order (`WorkspaceView.number`), instead of dynamically sorting by recency or hoisting blocked spaces to the top of the list.

Blocked spaces still display their triage indicators (tinting, status badges, "needs you" counts) and start auto-expanded by default (`prefs.spaceOpen[id] ?? blocked`), but their position in the tree remains fixed according to the snapshot order.

## What Changed

### 1. `web/src/components/space-tree.tsx`
- Removed `sortSpacesByRecency` import from `@/lib/spaces`.
- Replaced the recency-sorting and blocked-first regroup pipeline with direct filtering over snapshot `workspaces`:
  ```ts
  // Before:
  const recencySorted = sortSpacesByRecency(workspaces, panes, lastSeen);
  const filtered = filterSpaces(recencySorted, query);
  const visible = [
    ...filtered.filter((w) => worstBySpace.get(w.workspaceId) === "needs"),
    ...filtered.filter((w) => worstBySpace.get(w.workspaceId) !== "needs"),
  ];

  // After:
  const visible = filterSpaces(workspaces, query);
  ```
- Retained in-place triage calculations (`worstBySpace`, `blockedSpaces`, status indicators) and auto-expansion behavior.

### 2. `web/src/components/space-tree.test.tsx`
- Updated test `"blocked spaces sort first and start expanded by default"` to `"blocked spaces render in snapshot order, show blocked state, and start expanded by default"`.
- Added assertion comparing document positions of spaces (`compareDocumentPosition`) to verify that `normal-space` (listed first in fixtures) renders before `blocked-space` (listed second), despite `blocked-space` having a blocked agent and older `lastSeenAt`.
- Verified that the blocked space still auto-expands and reports "1 space needs you".

### 3. Version Bump & Changelog
- Bumped PATCH version `0.45.0` -> `0.45.1` across `herdr-plugin.toml`, `package.json`, and `web/package.json`.
- Added CHANGELOG entry under `## [0.45.1] - 2026-08-20` in `CHANGELOG.md`.

## Verification

Run frontend test suite:
```bash
cd web && bun run test
```

Check version consistency across plugin manifest and package definitions:
```bash
bash scripts/check-version.sh
```
