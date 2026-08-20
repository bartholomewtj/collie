# Plan: Replace Herd + space detail with one Spaces tree at `/`

`web/` only. No changes to `bridge/`, the Herdr API, or any data shape — every field the tree needs (`workspaces`, `tabs`, `agents`, `shellPanes`) is already on the root snapshot. Two screens die (`routes/home.tsx` Herd, `routes/space.tsx` space detail); the Spaces list becomes a three-level folder tree that is the app's home at `/`.

Reference docs: `web/CLAUDE.md` (test/build commands, conventions), `CLAUDE.md` at repo root (versioning + CHANGELOG policy).

## 1. `hooks/use-dash-prefs.ts` — new persisted expansion state

`spacesOpen` is dead (nothing outside this file reads it — verified). Replace it:

- `DashPrefs`:
  - **Delete** `spacesOpen: boolean | null`.
  - **Add** `spaceOpen: Record<string, boolean>` — per-space explicit expansion choice. Absent key = never chosen. (A plain `expandedSpaces: string[]` can't express "explicitly collapsed", and the needs-auto-expand rule requires distinguishing "collapsed by the user" from "never touched".)
  - **Add** `expandedTabs: string[]` — tab ids whose pane list is expanded.
  - **Keep** `recentOpen`, `recentDir`, `shellsOpen` — read by `agent-sidebar` via `agent-chat.tsx:944-948` (in-pane pane switcher, out of scope). Keep `openForCount` + `COLLAPSE_THRESHOLD` exported (still used for `shellsOpen`).
- `STORAGE_KEY` → `"collie:dash-prefs:v2"` so an old payload can't half-load.
- `coerceDashPrefs`: `spaceOpen` must be an object whose values are all booleans (else `{}`); `expandedTabs` must be an array of strings filtered to strings (else `[]`).
- New setters: `setSpaceOpen(workspaceId, open)` (records an explicit choice either way), `expandSpace(workspaceId)` (sets true — used by the redirect/helper), `toggleTab(tabId)` or `setTabOpen(tabId, open)` for tab expansion.
- `use-dash-prefs.test.ts`: update the 6 `spacesOpen` references; add malformed-payload cases (non-object `spaceOpen`, non-string entries in `expandedTabs`).

Effective space expansion rule (in the tree component, not the hook): a space is open iff `spaceOpen[id] ?? (worstBucket === "needs")` — explicit choice always wins, mirroring `openForCount`'s precedence. Stale ids in either field are simply never looked up (the tree only renders ids present in the snapshot) — no empty shells.

## 2. `lib/spaces.ts` — one triage reducer, drop `tabsAreFlat`

- **Delete** `tabsAreFlat` (only caller was `routes/space.tsx`).
- **Add** `worstBucket(panes: readonly AgentView[]): TriageKey | null` — reduces a pane list to its worst bucket via `bucketOf` + `TRIAGE_ORDER` from `lib/triage.ts`. (It may simply delegate to the existing `worstTriage`; the point is one named classifier in `lib/spaces.ts`.)
- **Refactor** `spaceTriageMap` to route through the same ordering logic while keeping its single pass over agents (spaces × agents filtering is the regression its doc comment warns about). Acceptable shapes: keep the loop but share a `worseOf(a, b)` comparison with `worstBucket`, or one pass building per-space pane arrays then `worstBucket` per space — either way, one pass over `agents`.
- Leave `groupPanesByTab`, `spaceTriageMap`, `spaceLastSeenMap`, `sortSpacesByRecency`, `filterSpaces` in place — the tree uses all of them.

## 3. New component: `web/src/components/space-tree.tsx`

`SpaceTree` + test `space-tree.test.tsx`. This is the heart of the change; it absorbs `SpaceOverview`'s row/header/filter markup, `TabStrip`'s "New tab" affordance, and `SpaceView`'s `tabTraces` helper (lift `tabTraces` in here, exported for testing).

Props: `workspaces`, `tabs`, `agents`, `shellPanes`, `session`, `readOnly`, `onNewSpace`, `onRenamed` (revalidate), plus prefs (`spaceOpen`, `expandedTabs`) and setters from `useDashPrefs` (own the hook in the route and pass down, or call it in the tree — pick one; the redirect helper needs programmatic access too, see §5).

### Structure

- Section header (from `SpaceOverview`): `SectionHeader` label "Spaces", count (visible count while filtering), the red blocked-space count badge in `trailing`, and the `FolderPlus` "New space" button.
- Sticky `Filter spaces…` box — only when `workspaces.length > 1`, same markup.
- Empty states: "No spaces yet." / "No space matches “{query}”."
- Rows, three levels, one rule everywhere: **a row with exactly one child opens that child directly instead of expanding.**

### Derivation (single passes, map lookups — re-renders every poll)

```
panes = [...agents, ...shellPanes]
lastSeen = spaceLastSeenMap(panes)
worstBySpace = spaceTriageMap(agents)
```
Per expanded space: `groupPanesByTab(workspaceId, tabs, agents, shellPanes)` once, then per tab `worstBucket(group.panes)` and `tabTraces(group.panes)`. Never `.filter(panes)` inside a row render.

### Space row

- Chevrons `▸`/`▾` (lucide `ChevronRight`/`ChevronDown`, rotated or swapped) as a **sibling button** of the row body, own tap target, `stopPropagation` on click — never fires the row action or opens a sheet (the lanes-mark pattern in `space-overview.tsx`). Toggling records an explicit `setSpaceOpen(id, …)`.
- Row body tap (`SpaceRowButton` pattern: `select-none`, `[-webkit-touch-callout:none]`, **no** `touch-action: none`, `useLongPress` → `SpaceActionsSheet`):
  - exactly one tab → do whatever tapping that tab would do (so one-tab/one-pane opens the pane's CLI in one tap; one-tab/multi-pane expands the space **with that tab already open** — add the tab to `expandedTabs`);
  - two or more tabs → toggle expand (same as chevron).
  - Never a no-op.
- Visuals from `SpaceOverview`: `StatusDot` for `worstBySpace` + `sr-only {STATUS_LABEL[status]}` (colour alone is not a status), blocked-row tint (`rounded-lg border border-status-blocked/40 bg-status-blocked/5`), pane-count chip (`LayoutGrid` + count), `timeAgo(lastSeen)`, lanes mark (`LanesIcon`, live-run emerald dot, own sibling target with `stopPropagation`, opens `tracePath(spaceId, traceRepo, session)` using `sssf.attached?.repo ?? sssf.repos[0].name`).

### Tab row (indented, inside an expanded space)

- Long-press → `TabActionsSheet` (`onRenamed` + `onClosed` wired, same enable rules as before).
- StatusDot for `worstBucket(tabPanes)` + `sr-only` label; lanes mark via `tabTraces` (own target); `(empty tab)` note when the tab has no panes (row inert).
- Exactly one pane → tapping the row opens `panePath(paneId, session)`; no chevron.
- Two or more panes → chevron (own sibling target, `stopPropagation`) + row body both toggle the tab's expansion (`expandedTabs`).

### Pane row (indented one more level)

- Compact single-line row — **not** `AgentCard` (cards mean "a human is required here"; this is a tree leaf). Own `StatusDot` + `sr-only` label, pane name, `timeAgo(p.lastSeenAt)`.
- Tap opens `panePath(p.paneId, session)`; long-press → `PaneActionsSheet` (`onRenamed` + `onPaneClosed`).

### `＋ New tab`

Last child of every expanded space: dashed-border button calling `newTab(workspaceId)` from `useSpaceActions` (the affordance `TabStrip` owned; must not be lost). `aria-label="New tab"`.

### Ordering

Blocked-first: stable sort — spaces whose `worstBySpace` bucket is `"needs"` first, each group (and the tail) ordered by `sortSpacesByRecency`. Filtering via `filterSpaces` first, order blocked-first after.

### Revalidation / fallbacks

Wire `onRenamed={() => revalidator.revalidate()}`; on tab close, drop a closed tab from `expandedTabs` if present, then revalidate; on pane close, revalidate. A closed space/tab simply disappears from the snapshot — no recovery bounce (the deleted `routes/space.tsx` logic has no home; stale ids in prefs are ignored).

## 4. Routes

- **Delete** `routes/home.tsx` (`HomeRoute`) and `routes/space.tsx` (`SpaceRoute`).
- **New** `routes/tree.tsx` → `TreeRoute`: the `/` page. Root-snapshot page shell identical to the old Spaces screen (`AppHeader` wordmark + `SessionSwitcher` in `rightLead` like the old HomeRoute, `ReadOnlyBanner`, `UpdateBanner`, `BuildStamp`, floating `StatusArea`) with `SpaceTree` in `<main>`, `NewSpaceSheet` state, `useSpaceActions().newSpace`, `useDashPrefs` passed through.
- **Rewrite** `routes/spaces.tsx` → `SpacesRedirect`: on mount, `navigate(homePath(session), { replace: true })`. Render `null` (or the BootSplash-ish nothing).
- **New** `routes/space.tsx` logic folds into a redirect: `SpaceRedirect` for `/space/:spaceId` — on mount, `expandSpace(spaceId)` (persisted set first), then `navigate(homePath(session), { replace: true })`. **No new URL parameter** — the persisted set is the state. A stale `spaceId` is harmless (it's just an ignored key until the space exists). Put this component in `routes/space.tsx` (rewritten, not deleted) or fold both redirects into `routes/spaces.tsx`/a small shared file — pick one place, keep it boring.
- `router.tsx`: `index: TreeRoute`; `spaces` → redirect; `space/:spaceId` → redirect; everything else unchanged.

## 5. `lib/nav.ts` + call sites

- Delete `spacePath` and `spacesPath`.
- New shared helper, e.g. `hooks/use-open-space.ts` → `useOpenSpace()` returning `(workspaceId: string) => void`: `expandSpace(workspaceId)` then `navigate(homePath(session), { replace: true })`? — no `replace` for the agent-chat case (a drill-in should push); use `replace: true` only in the redirect route. Keep the helper's navigation plain and let the redirect pass `{ replace: true }` separately, or give it an options arg. Used by:
  - `components/agent-chat.tsx:580-583` (`openSpace`, the nav-hub "go to this space"): replace `navigate(spacePath(...))` with the helper. Remove the `spacePath` import (keep `historyPath`, `tracePath`).
  - The `/space/:spaceId` redirect (§4).
- `components/bottom-nav.tsx`: drop the `herd` item, `PawPrint`, the `attention` prop and its red dot. Three items: Spaces (`homePath(session)`, `LayoutGrid`, lit on `pathname === "/"`), Traces, Settings. Update the doc comment.
- `routes/root.tsx`: `showNav` = `pathname === "/" || pathname === "/traces" || pathname.startsWith("/traces") || pathname === "/settings"` (keep the traces-startsWith if present behaviour uses it — current code uses `pathname === "/traces"` only; keep exactly `/`, `/traces`, `/settings` per the brief). Drop the `attention` computation and the prop.
- `routes/detail.tsx:60-61`: `upPath` becomes `from ?? homePath(session)` unconditionally; delete `lastWorkspace` (then unused). Keep honouring `state.from`.
- `routes/spaces.tsx:39`, `routes/space.tsx:49,69` — covered by the rewrite/deletion above.

## 6. Files to delete (with their tests)

- `components/agent-list.tsx` + `agent-list.test.tsx` (only `routes/home.tsx` used it; `agent-sidebar` is different and **stays**).
- `components/tab-strip.tsx` + `tab-strip.test.tsx`.
- `components/space-view.tsx` + `space-view.test.tsx` (lift `tabTraces` into `space-tree.tsx`).
- `components/space-overview.tsx` + `space-overview.test.tsx` (row markup absorbed into `space-tree.tsx`).
- `lib/spaces.ts`: `tabsAreFlat` (§2).

## 7. Tests to update (existing suites that reference the old shape)

- `routes/detail.test.tsx:135` — the back/up path now expects `"/"` not `"/space/w1"`; adjust the fixture.
- `components/agent-chat.test.tsx:87,107` — the router stub has a `/space/:spaceId` sentinel route; the nav-hub "go to this space" action now navigates to `/` (with the space expanded via prefs — assert location `/`), so update the stub/assertions.
- `routes/root.test.tsx` — currently only asserts BootSplash copy; if any assertion touches `attention`/nav items, update to the three-item bar.
- `hooks/use-dash-prefs.test.ts` — §1.

## 8. New tests (in `components/space-tree.test.tsx`, router-stub pattern like `agent-chat.test.tsx`)

Cover at minimum:

1. **One-tab/one-pane shortcut**: tapping a space with exactly one tab holding one pane navigates to that pane's CLI (`/pane/…`) — no expansion happens.
2. **Multi-pane tab expands rather than opens**: a space with one tab holding ≥2 panes — tapping the space expands it (with the tab expanded); tapping the tab row (multi-pane) toggles the tab's pane list instead of navigating.
3. **Chevron tap ≠ row action**: clicking a space's chevron toggles expansion and does **not** navigate or open the actions sheet (assert no `panePath` navigation; the lanes-mark sibling already proves the pattern).
4. **Blocked-first ordering + auto-expand vs explicit collapse**: spaces with a `needs` bucket render before others; a `needs` space starts expanded by default; after the user collapses it, a re-render (new snapshot) keeps it collapsed (explicit choice wins).
5. Bonus if cheap: `＋ New tab` calls `newTab(workspaceId)`; tab with 0 panes renders `(empty tab)` inertly; `expandedTabs`/`spaceOpen` persist through a remount (prefs round-trip).

Also a small unit test for `worstBucket` / the refactored `spaceTriageMap` if `lib/spaces.ts` has a test file — check `web/src/lib/*.test.ts` and extend it; if none exists, the tree tests cover it via row dots.

## 9. Version + changelog

- Bump `0.40.7` → `0.40.8` in **all three**: `herdr-plugin.toml` (line 3), `package.json`, `web/package.json` (`scripts/check-version.sh` enforces the match).
- `CHANGELOG.md`: new `## [0.40.8]` heading under the header block, `### Changed` — Herd and the space detail screen replaced by one Spaces tree at `/` (triage, tabs and panes as an expandable tree; `/spaces` and `/space/:id` redirect).

## 10. Out of scope (do not touch)

`bridge/`, backend routes, `routes/detail.tsx` beyond the one back-target change, traces screens, `agent-sidebar`, `command-palette`, the in-pane pane switcher, Settings, push notifications, `lib/triage.ts`'s classifier, upstream sync, and the dirty `AGENTS.md` / `GEMINI.md` files (separate known issue — leave unstaged).

## 11. Verification (done means)

1. `cd web && bun run test` passes; `bun run build` succeeds.
2. `grep -rn "spacePath\|spacesPath\|AgentList\|TabStrip\|SpaceView\|SpaceOverview\|tabsAreFlat" web/src` → nothing outside deleted files (deleted files are gone, so: nothing at all).
3. Manual/dev sanity (or covered by tests): `/spaces` and `/space/<id>` land on `/` with the right space expanded; every long-press sheet, the lanes marks, the filter box, `New space`, `New tab` work; one-child shortcuts behave at all three levels; a stale expanded id renders no empty shell.
4. Version triple bumped + CHANGELOG entry present (`scripts/check-version.sh` clean).

## Suggested order of work

1. `use-dash-prefs` v2 + tests (foundational, independent).
2. `lib/spaces.ts`: `worstBucket`, refactor `spaceTriageMap`, drop `tabsAreFlat`.
3. `space-tree.tsx` + tests (biggest piece; build against the old routes still compiling).
4. Routes: `tree.tsx`, redirects, `router.tsx`, `nav.ts`, `bottom-nav.tsx`, `root.tsx`, `detail.tsx`, `agent-chat.tsx` (+ their test updates).
5. Delete dead components/tests.
6. Version bump + CHANGELOG; run full test + build; run the greps.
