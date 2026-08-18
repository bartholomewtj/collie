# Spaces page: show the traces (lanes) icon on each space row, green dot while a run is live

## What
The pane header (`web/src/components/agent-chat.tsx`, ~line 654) shows a Traces button — `LanesIcon`
from `web/src/components/sssf-frame.tsx`, with a small `bg-emerald-400` dot at top-right while any run
is `running` — that navigates to `tracePath(...)`. The **Spaces** page (`web/src/routes/spaces.tsx` →
`web/src/components/space-overview.tsx`) has nothing like it, so from the space list you can't see
which space has an ADW running, nor jump to its traces.

## Fix
- In `SpaceOverview`, on each space row that has SSSF traces (`w.sssf` present and
  `w.sssf.repos.length > 0`), render the same `LanesIcon` (reuse it — do not draw a new icon) as a
  trailing element on the row, next to the pane-count pill. Same visual language as the pane header:
  plain muted icon normally; **green dot** (`bg-emerald-400`, `ring-2 ring-background`, same size/
  position classes as agent-chat.tsx) when a run is live. "Live" = `w.sssf.repos.some((r) => r.running)`
  (equivalently `w.sssf.attached?.adwId` is set — prefer the `repos.some(running)` check, and add a
  one-line comment saying they agree). Spaces with no `sssf` show nothing extra.
- Tapping the icon opens that space's traces: `tracePath(w.workspaceId, repo, session)` from
  `web/src/lib/nav.ts`, where `repo = w.sssf.attached?.repo ?? w.sssf.repos[0].name` (`repo` is a
  bridge-assigned name, never a path). Tapping the rest of the row still opens the space as today.
  The row is currently a single `<button>` — a button can't nest a button, so restructure minimally:
  either make the row a `<div>` with the label area as the button, or make the icon a sibling element
  positioned in the row. Whichever you pick, keep the tap targets ≥ 36px, keep the row's existing
  classes/hover/active look, and stop propagation so the icon tap doesn't also open the space.
- Thread `session` (`data.session`) from `SpacesRoute` into `SpaceOverview` (new optional prop) so the
  path carries the session, matching how `spacePath(id, data.session)` is already used there.
- `aria-label`: "ADW runs in this space (one running)" / "ADW runs in this space" — mirror the pane
  header's wording. The dot itself is `aria-hidden`.

## Tests
- Add cases to the existing `web/src/components/space-overview.test.tsx` if it exists, otherwise create
  it (Vitest + Testing Library, look at neighbouring `*.test.tsx` for the pattern): a space with
  `sssf.repos` renders the lanes button; `running: true` on any repo renders the dot; a space with no
  `sssf` renders no lanes button; tapping the lanes button navigates to `/traces/<spaceId>/<repo>`
  (with `?session=` when a session is given) and does NOT call `onOpen`; tapping the row still calls
  `onOpen`.
- `cd web && bun run test` and the typecheck (`cd web && bunx tsc --noEmit`) must pass.

## Out of scope
- Do NOT bump the version or edit `CHANGELOG.md` — the release commit is cut afterwards.
- No bridge changes (the snapshot already stamps `workspace.sssf`), no new dependencies, no change to
  the pane header button or the Traces route.
