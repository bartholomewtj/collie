# Spaces Page: Lanes (Traces) Icon and Live Run Indicator

## Summary

Added a trailing traces ("lanes") action button with an active run indicator (emerald dot) to space rows on the Spaces overview page (`SpaceOverview`), matching the visual language of the agent chat pane header. Users can now immediately see if an ADW run is active in a space and navigate directly to that space's SSSF trace view.

## Context & Motivation

Previously, the Spaces screen (`web/src/routes/spaces.tsx` / `web/src/components/space-overview.tsx`) showed only static status dots, space labels, pane counts, and recency timestamps. Users could not tell from the space list whether an ADW was actively executing in a space, nor could they jump straight to execution traces without first opening the space and navigating to a pane.

## Changes Made

### 1. `web/src/components/space-overview.tsx`
- **Session Prop**: Added optional `session?: string` to `SpaceOverviewProps` and destructured it in `SpaceOverview` to ensure navigation links preserve the active session scope.
- **Traces State & Repo Resolution**:
  - Computed `sssf` presence (`w.sssf && w.sssf.repos.length > 0`).
  - Computed target repo `traceRepo` (`sssf.attached?.repo ?? sssf.repos[0].name`).
  - Computed active run state `runLive` (`sssf.repos.some((r) => r.running)`).
- **Row DOM Restructure**: Converted the outer row element from a single `<button>` to a `<div>`, nesting:
  - A primary `<button>` for space selection (`onOpen(w.workspaceId)`), containing the status dot, label, pane count badge, and timestamp.
  - A sibling `<button>` for trace navigation, preventing invalid nested button markup while maintaining accessible tap targets (≥36px).
- **Lanes Mark & Live Dot**:
  - Rendered `LanesIcon` (imported from `web/src/components/sssf-frame.tsx`).
  - Rendered an `aria-hidden` emerald status badge (`bg-emerald-400 ring-2 ring-background`) when `runLive` is true.
  - Set descriptive `aria-label` attribute: `"ADW runs in this space (one running)"` when active vs. `"ADW runs in this space"` when idle.
  - Handled click via `navigate(tracePath(w.workspaceId, traceRepo, session))` with `e.stopPropagation()`.

### 2. `web/src/routes/spaces.tsx`
- Passed `session={data.session}` to `<SpaceOverview />` alongside existing props.

### 3. `web/src/components/space-overview.test.tsx`
- **Router Context in Test Helper**: Wrapped `view()` in `MemoryRouter` with a `LocationProbe` component to support assertions on `useNavigate` calls without requiring a full data router.
- **Fixture Helpers**: Updated `ws()` and added `sssf()` helper to generate mock `WorkspaceView` objects with SSSF repo and attached repo data.
- **Test Suite (`SpaceOverview — traces mark`)**:
  - Verified lanes button renders when `sssf.repos` is populated.
  - Verified lanes button does not render when `sssf` is undefined or `sssf.repos` is empty.
  - Verified green dot and updated `aria-label` when `running: true`.
  - Verified omission of green dot when no runs are active.
  - Verified navigation to `/traces/<spaceId>/<repo>` without triggering `onOpen`.
  - Verified inclusion of session query parameter (`?s=<session>`) when session is provided.
  - Verified navigation targets the bridge-attached repository name when specified.
  - Verified tapping the main row button still calls `onOpen`.

### 4. `specs/8d2c86fe_spaces-lanes-icon.md`
- Added the design and technical specification for the feature.

## Verification

Run the web test suite:
```bash
cd web && bun run test
```

Run TypeScript typecheck:
```bash
cd web && bunx tsc --noEmit
```
