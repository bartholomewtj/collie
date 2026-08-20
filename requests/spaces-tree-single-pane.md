# Replace Herd and the space detail screen with one Spaces tree

Collie's phone UI has four top-level destinations (Herd `/`, Spaces `/spaces`, Traces, Settings)
plus a separate space detail screen at `/space/:spaceId` with a tab chip strip. Two of those screens
are being removed. Everything spaces-and-tabs collapses into **one page**, a folder tree, and that
page becomes the app's home at `/`.

This is a `web/` change only. Do not touch `bridge/`, the Herdr API, or any data shape — every field
the tree needs (`workspaces`, `tabs`, `agents`, `shellPanes`) is already on the root snapshot.

## The tree

Three levels, with the same rule at each: **a row that has exactly one child opens that child
directly instead of expanding.**

```
▾ geneanalysis                    ● needs you   2m   [lanes] 
   ▸ adw-run                        2 panes
   ● claude ──────────────────────────────────────► opens the pane CLI (1 pane)
   ＋ New tab
▸ collie                          ● working     5m
○ paperfetch                                    1h  ──► 1 tab, 1 pane: opens the CLI
```

- **Space row.** A chevron (`▸`/`▾`) on the left is its own tap target and toggles expand. Tapping
  the row body does *whatever tapping its single tab would do* when the space has exactly one tab —
  so a one-tab/one-pane space opens that pane's CLI in one tap, and a one-tab/three-pane space
  expands with that tab already open. With two or more tabs the row body toggles expand, same as the
  chevron. A row tap is never a no-op.
- **Tab row**, indented, shown when the space is expanded. A tab with exactly one pane opens that
  pane's CLI and shows no chevron. A tab with two or more panes shows a chevron and expands to its
  pane rows. A tab with no panes renders inert with the existing `(empty tab)` note.
- **Pane row**, indented one level further, opens the pane CLI (`panePath`).
- The last child of an expanded space is a **`＋ New tab`** row calling `newTab(workspaceId)` from
  `useSpaceActions` — that affordance currently lives in `TabStrip` and must not be lost with it.

Expansion state persists across polls, navigations and reloads (see *Preferences* below). The tree
re-renders on every poll, so derive per-space and per-tab data in single passes and look it up by
map, the way `spaceTriageMap` / `spaceLastSeenMap` already do — never filter the pane array per row.

## Triage moves onto the rows

Removing Herd must not lose "an agent is waiting on me".

- Space rows show a `StatusDot` for the worst bucket in the space (`spaceTriageMap`), with the
  status word as `sr-only` text — a bare colour is not an accessible status. Keep the existing
  blocked-row tint, the pane-count chip and the `timeAgo(lastSeen)` stamp from `SpaceOverview`.
- Tab rows show the worst bucket across that tab's panes. Add one helper to `lib/spaces.ts` that
  reduces a pane list to a `TriageKey` via the existing `bucketOf` + `TRIAGE_ORDER`, and have
  `spaceTriageMap` and the tab rows both route through it — one classifier, one answer, the rule
  `lib/triage.ts` already documents.
- Pane rows show their own `StatusDot`, name and `timeAgo`. Use a compact row, **not** `AgentCard`:
  a card is the right weight for "a human is required here", not for a leaf in a tree.
- Spaces sort blocked-first, then by `sortSpacesByRecency`.
- A space whose worst bucket is `needs` starts expanded, unless the user has explicitly collapsed it
  — an explicit choice always wins, the same precedence `openForCount` already implements for
  count-sensitive sections.
- Keep the red blocked-space count badge in the section header (`SpaceOverview`'s `trailing`).

## Everything that must survive the move

- The sticky `Filter spaces…` box, still only when `workspaces.length > 1`.
- `New space` (the `FolderPlus` header button and `NewSpaceSheet`).
- All three long-press action sheets: `SpaceActionsSheet` on a space row, `TabActionsSheet` on a tab
  row, `PaneActionsSheet` on a pane row. A chevron tap must never open a sheet or fire the row's
  action — make it a sibling target with `stopPropagation`, the pattern the lanes mark already uses.
- The lanes/traces mark on space rows (`SpaceOverview`) and on tab rows (`TabHeading` in
  `space-view.tsx`, whose `tabTraces` helper picks the pane owning the tab's newest run). Both stay,
  both as their own tap targets.
- `onRenamed` / `onClosed` / `onPaneClosed` revalidation, including the fallback when the thing you
  were filtered to gets closed.
- iOS long-press handling on every row: `select-none` and `[-webkit-touch-callout:none]`, and
  deliberately **no** `touch-action: none` — the tree has to keep scrolling, and a scroll cancels
  the hold.

## Routing and navigation

- `/` renders the tree. Delete `routes/home.tsx` (`HomeRoute`) and `routes/space.tsx` (`SpaceRoute`).
- `/spaces` and `/space/:spaceId` become redirects, so existing bookmarks, push-notification deep
  links and the PWA's saved start URL keep working. `/spaces` → `/`. `/space/:spaceId` → `/` with
  that space added to the persisted expanded set first, then `navigate(homePath(session), { replace:
  true })`. Do not invent a new URL parameter for expansion — the persisted set is the state.
- `lib/nav.ts`: delete `spacePath` and `spacesPath`. Call sites to update:
  - `components/bottom-nav.tsx:28` — the Spaces item now points at `homePath`.
  - `components/agent-chat.tsx:582` — the in-pane "go to this space" action. Route it through the
    same "expand this space, then go home" helper the redirect uses.
  - `routes/detail.tsx:61` — the pane's back target. Keep honouring `state.from`; the fallback
    becomes `homePath(session)` unconditionally. `lastWorkspace` may become unused there.
  - `routes/spaces.tsx:39`, `routes/space.tsx:49,69` — those files are being deleted or rewritten.
- `components/bottom-nav.tsx`: drop the `herd` item, its `PawPrint` icon and the `attention` prop
  and red dot (triage now lives on the tree rows). Three items remain: Spaces (`/`, `LayoutGrid`),
  Traces, Settings. The Spaces item is lit on `pathname === "/"`.
- `routes/root.tsx`: `showNav` becomes `/`, `/traces`, `/settings`. Drop the `attention` computation
  it passes to `BottomNav`.
- `routes/space.tsx`'s deleted-space recovery (bounce to the list once a healthy snapshot no longer
  has the space) has no home now that there is no space screen — an expanded space that disappears
  simply drops out of the tree. Make sure a stale id left in the persisted expanded set is ignored
  rather than rendering an empty shell.

## Preferences

`hooks/use-dash-prefs.ts`: `spacesOpen` is already dead (nothing reads it) — replace it with the
tree's expansion state, e.g. `expandedSpaces: string[]` and `expandedTabs: string[]`, and bump
`STORAGE_KEY` to `v2` so an old payload can't half-load. **Keep `recentOpen`, `recentDir` and
`shellsOpen`** — those are read by `agent-sidebar` through `agent-chat.tsx:944-948`, which is the
in-pane pane switcher and is not part of this change. Extend `coerceDashPrefs` to defend the new
array fields against a malformed payload, and cover that in the existing hook test.

## Files that become dead — delete them with their tests

`components/agent-list.tsx` (+ `agent-list.test.tsx`) — only `routes/home.tsx` used it;
`agent-sidebar` is a different component and stays. `components/tab-strip.tsx` (+ test),
`components/space-view.tsx` (+ test), `components/space-overview.tsx` (+ test) — all three were
only reachable from the two deleted routes; lift `tabTraces` and whatever row markup you keep into
the new tree component. `lib/spaces.ts`'s `tabsAreFlat` — its only caller was `routes/space.tsx`.
Leave `groupPanesByTab`, `spaceTriageMap`, `spaceLastSeenMap`, `sortSpacesByRecency` and
`filterSpaces` in place; the tree uses all of them.

## Done means

- `/` shows the tree; expanding, collapsing and the one-child shortcuts all behave as described, at
  all three levels.
- Every long-press sheet, the lanes marks, the filter box, `New space` and `New tab` still work.
- No route or component still references `spacePath` / `spacesPath` / `AgentList` / `TabStrip` /
  `SpaceView` / `SpaceOverview` / `tabsAreFlat`; `grep -rn` for each returns nothing outside deleted
  files.
- `/spaces` and `/space/<id>` land on `/` with the right space expanded.
- New tests cover the tree: the one-tab-one-pane shortcut opening a pane directly, a multi-pane tab
  expanding rather than opening, a chevron tap not firing the row action, and blocked-first ordering
  with auto-expand losing to an explicit collapse.
- `cd web && bun run test` passes and `bun run build` succeeds. Delete the tests of deleted
  components rather than leaving them to fail.
- Bump the version in `herdr-plugin.toml`, `package.json` and `web/package.json` (this touches
  `web/src/`, so the pre-commit guard requires it) and add a `CHANGELOG.md` entry.

## Out of scope

The bridge and every backend route. The pane screen itself (`routes/detail.tsx`) beyond its one back
-target line. The traces screens. `agent-sidebar`, `command-palette` and the in-pane pane switcher.
Settings. Push notifications. Any change to `lib/triage.ts`'s classifier. Upstream sync with
AltanS/collie. The two dirty files `AGENTS.md` and `GEMINI.md` in the working tree — leave them
alone, they are a separate known issue.
