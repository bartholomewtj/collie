# Plan — Fixed order in the spaces list (drop recency sort + blocked-first regroup)

## Goal

The spaces list on `/` (home tree) currently reorders itself two ways before rendering:
recency (most-recently-used first) and a blocked-first regroup. Both go away. The rendered
order becomes exactly the snapshot's existing workspace order (Herdr's order /
`WorkspaceView.number`) — stable, no jumps. Blocked state still shows in place via the
existing badge/colour/tint, and auto-expand of blocked spaces stays
(`prefs.spaceOpen[id] ?? blocked`).

Version bump: PATCH `0.45.0` → `0.45.1`.

## Files to touch

1. `web/src/components/space-tree.tsx`
2. `web/src/components/space-tree.test.tsx`
3. `herdr-plugin.toml`, `package.json`, `web/package.json` (version → `0.45.1`)
4. `CHANGELOG.md` (new `## [0.45.1]` entry, Fixed line)

## 1. `web/src/components/space-tree.tsx`

Two edits, both in `SpaceTree`:

**a) Remove the import.** Delete `sortSpacesByRecency` from the `@/lib/spaces` import block
(around line 17). Everything else in that import stays.

**b) Replace the sorting/regroup block (currently ~lines 103–109):**

```ts
const recencySorted = sortSpacesByRecency(workspaces, panes, lastSeen);
const filtered = filterSpaces(recencySorted, query);
// Blocked spaces first, recency preserved within each group
const visible = [
  ...filtered.filter((w) => worstBySpace.get(w.workspaceId) === "needs"),
  ...filtered.filter((w) => worstBySpace.get(w.workspaceId) !== "needs"),
];
```

becomes:

```ts
// Fixed order: Herdr's workspace order, straight from the snapshot. No recency sort, no
// blocked-first regroup — blocked state shows in place instead of lifting the row.
const visible = filterSpaces(workspaces, query);
```

Do NOT touch anything else:

- `lastSeen = spaceLastSeenMap(panes)` stays — it still feeds `timeAgo(seen)` on each row.
- `worstBySpace` / `blockedSpaces` stay — they feed the per-row status dot, the blocked
  row tint, and the header's "N spaces need you" chip.
- `isSpaceExpanded = prefs.spaceOpen[w.workspaceId] ?? blocked` stays (auto-expand of
  blocked spaces is unchanged).
- Header count, filter button logic, everything below the tree body — unchanged.

Note: `filterSpaces` with an empty query returns `[...workspaces]` (a copy), so `visible`
is a fresh array either way; no mutation risk.

## 2. `web/src/components/space-tree.test.tsx`

Rework the first test in the "triage ordering and auto-expand" describe block
(~line 245): **"blocked spaces sort first and start expanded by default"**.

- Rename it to reflect the new contract, e.g. *"blocked spaces render in snapshot order,
  show blocked state, and start expanded by default"*.
- Keep the existing fixtures: `wNormal` ("normal-space", `lastSeenAt: 500`) listed FIRST,
  `wBlocked` ("blocked-space", status `"blocked"`, `lastSeenAt: 100`) listed SECOND. The
  old code would have lifted `blocked-space` above `normal-space` (recency: 100 > 500 is
  false, but blocked-first would) — these fixtures now double as the ordering assertion.
- Keep the auto-expand assertions as they are (collapse-space blocked-space button present,
  expand-space normal-space button present, `tab-block` visible, `tab-norm` not).
- Add the ordering assertion: `normal-space` renders BEFORE `blocked-space` in the
  document. The rows sit in `#spaces-body`; compare document positions, e.g.:

```ts
const normal = screen.getByText("normal-space").closest("div")!;
const blocked = screen.getByText("blocked-space").closest("div")!;
expect(
  normal.compareDocumentPosition(blocked) & Node.DOCUMENT_POSITION_FOLLOWING,
).toBeTruthy();
```

  (`closest("div")` reaches the per-space wrapper `div` keyed by `workspaceId`; any shared
  ancestor works for the comparison, so even the label's own element is fine — pick one
  and stay consistent.)
- Also assert the blocked visuals are still present in place, so the "shows in place" half
  of the contract is pinned: the blocked row wrapper keeps the blocked tint — simplest
  durable check is that the status dot's sr-only label is present:
  `screen.getByText("Needs you")` (or whatever `STATUS_LABEL` maps the blocked bucket to —
  check `web/src/lib/types.ts` / `TRIAGE_STATUS` and use the real label; if it's easier,
  assert on the header chip `aria-label` "1 space needs you" instead, which is already
  stable markup).

The second test ("explicit collapse beats the auto-expand rule and persists") is unchanged.

Leave `web/src/lib/spaces.test.ts` and the `sortSpacesByRecency` helper
(`web/src/lib/spaces.ts`) **untouched** — the helper keeps its own unit tests; the tree
just stops calling it. (After the edit, grep to confirm `sortSpacesByRecency` is imported
nowhere outside `lib/spaces.ts` + its test.)

## 3. Version bump (PATCH) + CHANGELOG

Functional change under `web/src/`, so per CLAUDE.md:

1. Set `version = "0.45.1"` / `"version": "0.45.1"` in `herdr-plugin.toml`,
   `package.json`, `web/package.json` — all three identical.
2. New `CHANGELOG.md` heading `## [0.45.1] - <today's real date>` above `## [0.45.0]`,
   with a Fixed line, crisp one-liner style:
   `### Fixed`
   `- Spaces list keeps Herdr's workspace order — no more recency jumps or blocked-first reshuffling; blocked spaces still tint and auto-expand in place (<short hash>)`
   Style rule: cite the functional commit's short hash at the end of the line, so land the
   code commit first, then the release/version commit.
3. Run `bash scripts/check-version.sh` — must print `✓`.

## Verification

1. `cd web && bun run test` — all green, including the reworked ordering test.
   (Windows host is fine; web tests pass there.)
2. `bash scripts/check-version.sh` → `✓`.
3. Optional sanity: `bun run build` at the root (typechecks both sides + builds) —
   catches the now-unused import if any lint/tsconfig surprise.

## Out of scope

Filter-by-query behaviour, blocked badge/colour visuals, auto-expand of blocked spaces,
`bridge/`, Herdr, `sortSpacesByRecency` and its own unit tests, adws/, other issues,
docs PRs #84/#86.
