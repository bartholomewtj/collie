# Plan: Remove traces icons from the Spaces pane; fold "Filter spaces" into a top-panel icon

Scope of record: `web/src/components/space-tree.tsx` and `web/src/components/space-tree.test.tsx` only.
Out of scope (do NOT touch): the traces button in `agent-chat.tsx`, `LanesIcon` in `sssf-frame.tsx`
itself, `routes/traces.tsx`, anything in `bridge/`, version bump, `CHANGELOG.md` (per the task).

## Current state (verified)

In `web/src/components/space-tree.tsx`:

1. **Space-row traces button** (≈ lines 288–304): when `w.sssf?.repos.length > 0`, a `size-8`
   button with `LanesIcon` navigates to `tracePath(w.workspaceId, traceRepo, session)`; a green dot
   shows when a run is live. The `sssf` / `traceRepo` / `runLive` derivations (≈ lines 273–275)
   exist only to feed it.
2. **Tab-row traces button** (≈ lines 375–402): when `tabTraces(tabPanes)` finds a run, a `size-7`
   button with `LanesIcon` navigates to `tracePath(..., { pane: tabTracesInfo.paneId })` with
   `state: { from: pathname + search }`. The exported `tabTraces` helper (lines 31–48) is used
   **only** here (grep-verified: no other import of `tabTraces` anywhere in `web/src`).
3. **Filter box** (≈ lines 190–203): a full-width `sticky` search `<label>` inside
   `#spaces-body`, rendered whenever `workspaces.length > 1`, with `placeholder="Filter spaces…"`,
   `aria-label="Filter spaces"`, bound to local state `query`.
4. The Spaces `SectionHeader` trailing area holds the blocked-count badge + the "New space"
   `FolderPlus` button.

`SectionHeader`'s `trailing` slot is documented as "The section's own control (a sort toggle, a
'new' button)" — a filter toggle belongs there.

## Changes

### `web/src/components/space-tree.tsx`

**A. Delete the space-row traces button.**
- Remove the `{sssf && traceRepo && (<button …>)}` block (lines ≈288–304).
- Remove the now-unused derivations `sssf`, `traceRepo`, `runLive` (lines ≈273–275). (`w.sssf` on
  the type stays — the bridge still sends it and `routes/traces.tsx` still uses it.)

**B. Delete the tab-row traces button.**
- Remove the `{tabTracesInfo && (<button …>)}` block (lines ≈375–402).
- Remove `const tabTracesInfo = tabTraces(tabPanes);` (line ≈319) and delete the exported
  `tabTraces` function (lines 31–48) — it has no other consumer; leaving it would be dead code.

**C. Clean up imports that only fed A/B.** `noUnusedLocals` fails the build otherwise:
- Drop `LanesIcon` from the `@/components/sssf-frame` import (delete the line — it's the only
  symbol imported from there).
- Drop `tracePath` from the `@/lib/nav` import (keep `panePath`).
- Drop `useLocation` and the `const { pathname, search } = useLocation();` line — `pathname/search`
  were only used for the tab traces button's `state.from`. Keep `useNavigate`.

**D. Replace the list-body filter box with a header icon.**
- Delete the `workspaces.length > 1 && (<label …sticky…>)` block from `#spaces-body`.
- Add `const [filterOpen, setFilterOpen] = useState(false);` alongside `query`.
- In the `SectionHeader` trailing area, before the "New space" button, add a filter toggle button
  styled like the New-space button (`size-9 … rounded-md text-muted-foreground … active:scale-95`):
  - Shown when `workspaces.length > 1` (same gating the old box had — one space needs no filter).
  - `aria-label="Filter spaces"`, `aria-expanded={filterOpen}`.
  - Icon: `Search` (already imported from `lucide-react`) when closed; when open (or `query` is
    non-empty) show `X` from `lucide-react` instead, and clicking it closes the filter **and
    clears `query`** (a lingering filter the UI doesn't show is the trap this avoids).
- When `filterOpen` is true, render the input row **below the SectionHeader, above `#spaces-body`**
  — reuse the old markup (Search icon + `type="search"` input with `placeholder="Filter spaces…"`,
  `aria-label="Filter spaces"`, `min-h-9`), minus the `sticky top-0 z-10` (it is now a temporary
  reveal, not an always-there affordance). Add `autoFocus` so the tap flows straight into typing.
  Clicking the toggle while open clears + closes (see above); closing via the input's own clear
  (Ⓧ) just empties `query` and leaves the field open, same as today.

**E. Keep everything else identical**: `filterSpaces`, the blocked-first ordering, the
`SectionHeader` `count={query.trim() ? visible.length : workspaces.length}`, the "No space matches…"
empty state, one-child shortcuts, long-press sheets.

### `web/src/components/space-tree.test.tsx`

Existing tests don't touch the traces buttons or the filter, so nothing breaks — but the change
needs pinning. Add a new `describe("SpaceTree — traces and filter")` (with the same
`beforeEach(() => localStorage.clear())`):

1. **No traces button on space rows even when sssf data is present.** Render a workspace whose
   fixture carries `sssf: { state: "ready", token: "t", repos: [{ name: "repo-a", running: false }] }`
   (shape from `WorkspaceView["sssf"]` in `lib/types.ts`). Assert
   `screen.queryByRole("button", { name: /ADW runs in this space/i })` is not in the document.
2. **No traces button on tab rows.** Give a tab's agent `sssf: { runs: [{ repo: "repo-a", adwId:
   "a1", status: "running", startedAt: "2025-01-01T00:00:00Z" }] }` (`PaneSssfRun` shape), expand
   the space so the tab row renders, and assert
   `queryByRole("button", { name: /ADW runs in this tab/i })` is absent.
3. **Filter is hidden until the header icon is tapped.** Two workspaces ("alpha", "beta"). Assert
   `queryByPlaceholderText("Filter spaces…")` is absent and `getByRole("button", { name: "Filter
   spaces" })` is present in the header. Tap it → the input appears (autofocused). Type "alp" →
   only "alpha" is visible, "beta" is not, and the header count reflects the filtered count.
4. **Toggle clears the query.** Continuing from open-with-text: the toggle now shows the close
   affordance; tap it → input gone **and** "beta" visible again (query cleared, not just hidden).
   (Use `findByText`/async queries with `userEvent` where content appears conditionally.)

## Verification (in `web/`)

```
cd web && bun run test          # all of space-tree.test.tsx + the rest of the suite green
cd web && bunx tsc --noEmit     # strict, noUnusedLocals — confirms the import cleanup
```

Then in the running app (`bun run build` at root serves immediately, no restart): home tree shows
no lanes icon on any row; one space → no filter icon; two+ spaces → tap the search icon next to
New space → field drops in and filters.

## Notes / guardrails

- **This is a functional change under `web/src/`** but the task explicitly scopes out the version
  bump and CHANGELOG — the operator handles the release cut for this batch.
- Do not touch `agent-chat.tsx`'s traces button or `sssf-frame.tsx`'s `LanesIcon` export; both stay.
- `tabTraces` is exported but unused after this — delete it rather than leave dead code (the tsc
  pass won't flag exports, so this is on the builder).
