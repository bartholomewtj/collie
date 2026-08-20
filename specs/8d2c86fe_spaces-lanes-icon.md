# Plan — Lanes (traces) icon on each Spaces row, green dot while a run is live

## Goal

On the **Spaces** screen, every space that has SSSF traces gets the same lanes mark the pane header
already shows, as a trailing button on its row. A green dot on the mark means an ADW run is live in
that space. Tapping the mark opens that space's traces; tapping the rest of the row still opens the
space.

## Files to touch

| File | Change |
| --- | --- |
| `web/src/components/space-overview.tsx` | New `session?: string` prop; restructure the row; render the lanes button |
| `web/src/routes/spaces.tsx` | Pass `session={data.session}` to `SpaceOverview` |
| `web/src/components/space-overview.test.tsx` | Wrap renders in a router; add the new cases |

Nothing else. No bridge changes, no new dependencies, no version bump, no `CHANGELOG.md` edit, no
change to `agent-chat.tsx` or the Traces route.

## Facts already verified (don't re-derive)

- `LanesIcon` is exported from `web/src/components/sssf-frame.tsx` (line 13). Reuse it; do not draw a
  new icon.
- The pane header's Traces button lives in `web/src/components/agent-chat.tsx` (~line 650). Its dot is:
  `absolute right-1 top-1 size-1.5 rounded-full bg-emerald-400 ring-2 ring-background` with
  `aria-hidden="true"`, on a `relative` button.
- `WorkspaceView.sssf` (in `web/src/lib/types.ts`, ~line 120) is:
  ```ts
  sssf?: {
    state: "ready" | "pending";
    token: string;
    repos: Array<{ name: string; state: "ready" | "pending"; running: boolean }>;
    attached?: { repo: string; adwId?: string };
  };
  ```
- `tracePath(spaceId, repo, session?, scope?)` is in `web/src/lib/nav.ts`.
- **The session URL param is `s`, not `session`.** `sessionSearch()` (`web/src/lib/session.ts`)
  produces `?s=<name>`, or `""` for the primary session. So the expected path with a session is
  `/traces/w1/collie?s=demo`. (The task text said `?session=`; that is the *API* param name, not the
  browser one — go with `?s=`.)
- `web/src/components/space-overview.test.tsx` already exists (177 lines) and renders `SpaceOverview`
  with **no router**, via a `view(props)` helper that returns JSX passed to `render(...)`.

## Step 1 — `web/src/components/space-overview.tsx`

### Imports

Add:

```ts
import { useNavigate } from "react-router";
import { LanesIcon } from "@/components/sssf-frame";
import { tracePath } from "@/lib/nav";
```

### Props

Add to `SpaceOverviewProps`, with a comment in the file's voice:

```ts
  /** Herdr session scope of the snapshot (undefined = primary), so a traces link stays in-session. */
  session?: string;
```

Destructure `session` in the component signature. Call `const navigate = useNavigate();` at the top
of the component (alongside the existing `useState`).

### Row restructure

The row is currently a single `<button>` wrapping a `<div>`. A button can't nest a button, so invert
it: the **outer element becomes a `<div>`**, the label area becomes the button, and the lanes button
is its sibling *inside* the tinted inner div (so a blocked space's border/tint still surrounds the
whole row).

Inside `visible.map((w) => { ... })`, after the existing `bucket` / `status` / `blocked` / `seen`
locals, add:

```tsx
// A space's traces are worth a mark only when the bridge actually found a repo there.
const sssf = w.sssf && w.sssf.repos.length > 0 ? w.sssf : null;
// The repo the mark opens: the bridge's attached one, else the first it found (a NAME, never a path).
const traceRepo = sssf ? (sssf.attached?.repo ?? sssf.repos[0].name) : null;
// "Live" from the repos themselves; `sssf.attached?.adwId` agrees — the bridge only stamps that id
// while the attached run is still going.
const runLive = !!sssf?.repos.some((r) => r.running);
```

Then return this shape (keep every existing class string and comment; they are load-bearing and the
file's comments explain the design — carry them over rather than dropping them):

```tsx
<div
  key={w.workspaceId}
  className={cn(
    // Square, like the herd rows: this is a divide-y list, and a rounded fill under a straight
    // hairline reads as a fault. The blocked row below has a real border, so it keeps its radius.
    "w-full transition-colors",
    !blocked && "hover:bg-muted/50",
  )}
>
  {/* Flat rows, not cards … (keep the existing comment verbatim) */}
  <div
    className={cn(
      "flex flex-row items-center gap-3 px-2.5 py-2.5",
      blocked && "rounded-lg border border-status-blocked/40 bg-status-blocked/5",
    )}
  >
    {/* The row's own tap target: everything but the lanes mark opens the space. */}
    <button
      type="button"
      onClick={() => onOpen(w.workspaceId)}
      className="flex min-w-0 flex-1 flex-row items-center gap-3 text-left transition-transform active:scale-[0.99]"
    >
      {/* ——— unchanged: status dot / placeholder, label, pane-count pill, timeAgo ——— */}
    </button>

    {sssf && traceRepo && (
      <button
        type="button"
        onClick={(e) => {
          // The mark is a sibling of the row button, not nested in it — this is belt-and-braces
          // against the row ever regaining an outer handler.
          e.stopPropagation();
          navigate(tracePath(w.workspaceId, traceRepo, session));
        }}
        aria-label={runLive ? "ADW runs in this space (one running)" : "ADW runs in this space"}
        className="relative flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
      >
        <LanesIcon className="size-4" />
        {runLive && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 size-1.5 rounded-full bg-emerald-400 ring-2 ring-background"
          />
        )}
      </button>
    )}
  </div>
</div>
```

Notes for the builder:

- The status dot, the `<span className="sr-only">` status word, the label span, the pane-count pill
  and the `timeAgo` span move **inside** the new label button, unchanged. The `gap-3` that used to be
  on the row div is why the label button itself carries `flex items-center gap-3`.
- `active:scale-[0.99]` moves from the row onto the label button so the press feedback still tracks
  the thing you pressed.
- Tap targets: the row button is ~40px tall (`py-2.5` + text), the lanes button is `size-9` = 36px.
  Both clear the floor. Don't shrink either.
- The lanes button's chrome (`size-9 rounded-md`, muted → foreground on hover) matches this file's
  existing "New space" header button, so the page stays internally consistent; the **icon and the
  dot** are what mirror the pane header.
- A space with no `sssf`, or with `sssf.repos` empty, renders nothing extra.

## Step 2 — `web/src/routes/spaces.tsx`

Add one prop to the `<SpaceOverview …>` call:

```tsx
session={data.session}
```

(`data.session` is already used there for `spacePath(id, data.session)`.)

## Step 3 — `web/src/components/space-overview.test.tsx`

`SpaceOverview` now calls `useNavigate()`, which throws outside a router. Fix it once in the `view()`
helper so every existing test keeps working untouched.

### Helper changes

Add imports:

```ts
import { MemoryRouter, useLocation } from "react-router";
```

Add a location probe and wrap the component:

```tsx
/** Renders the current URL so a navigation is assertable without a data router. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>;
}

function view(props: Partial<Parameters<typeof SpaceOverview>[0]> = {}) {
  return (
    <MemoryRouter initialEntries={["/spaces"]}>
      <SpaceOverview
        workspaces={[]}
        agents={[]}
        onOpen={vi.fn()}
        onNewSpace={vi.fn()}
        open
        onOpenChange={vi.fn()}
        {...props}
      />
      <LocationProbe />
    </MemoryRouter>
  );
}
```

Every existing `render(view({ … }))` call stays as-is.

Extend the `ws()` fixture helper to take optional sssf data, e.g.:

```ts
function ws(
  workspaceId: string,
  label: string,
  tabCount: number,
  paneCount: number,
  sssf?: WorkspaceView["sssf"],
): WorkspaceView {
  return { workspaceId, number: 1, label, focused: false, activeTabId: `${workspaceId}:t1`, tabCount, paneCount, sssf };
}

function sssf(repos: Array<{ name: string; running?: boolean }>, attachedRepo?: string): NonNullable<WorkspaceView["sssf"]> {
  return {
    state: "ready",
    token: "tok",
    repos: repos.map((r) => ({ name: r.name, state: "ready", running: !!r.running })),
    attached: attachedRepo ? { repo: attachedRepo } : undefined,
  };
}
```

### New describe block — `SpaceOverview — traces mark`

Cases (names are suggestions; keep them descriptive in the file's voice):

1. **Shows the lanes mark for a space with SSSF repos.**
   `view({ workspaces: [ws("w1", "collie", 1, 1, sssf([{ name: "collie" }]))] })` →
   `expect(screen.getByRole("button", { name: "ADW runs in this space" })).toBeInTheDocument()`.
2. **No mark for a space with no traces.**
   `view({ workspaces: [ws("w1", "plain", 1, 1)] })` →
   `expect(screen.queryByRole("button", { name: /ADW runs in this space/ })).not.toBeInTheDocument()`.
   Also assert a space whose `sssf.repos` is empty renders no mark (`sssf([])`).
3. **A running repo changes the label (the dot is aria-hidden, so the label is what a test can see).**
   `sssf([{ name: "a" }, { name: "b", running: true }])` →
   `getByRole("button", { name: "ADW runs in this space (one running)" })`.
   Assert the dot itself too, since it's the visible cue: the found button should contain an element
   with class `bg-emerald-400` —
   `expect(btn.querySelector(".bg-emerald-400")).not.toBeNull()`, and for the non-running case
   `expect(btn.querySelector(".bg-emerald-400")).toBeNull()`.
4. **Tapping the mark goes to that space's traces and does not open the space.**
   `const onOpen = vi.fn();` with `sssf([{ name: "collie" }])` →
   click the mark → `expect(screen.getByTestId("loc")).toHaveTextContent("/traces/w1/collie")` and
   `expect(onOpen).not.toHaveBeenCalled()`.
5. **The session rides along.**
   Same as 4 with `session: "demo"` → probe text is `/traces/w1/collie?s=demo`.
6. **It opens the attached repo when the bridge named one.**
   `sssf([{ name: "first" }, { name: "second" }], "second")` → probe text is `/traces/w1/second`.
7. **Tapping the row still opens the space.**
   With an sssf space, click `screen.getByRole("button", { name: /collie/ })` →
   `expect(onOpen).toHaveBeenCalledExactlyOnceWith("w1")`.

Watch out: in case 7 the label text and the repo name can be the same string; the label button's
accessible name comes from the row text (label + "N panes" + time), and the mark's from its
`aria-label`, so `{ name: /collie/ }` still resolves to exactly one button. If a name collides,
disambiguate with the pane-count text rather than loosening the query.

## Verify

Run from the repo root (`C:\claudeOS\Projects\tools\collie`):

```sh
cd web && bun run test
cd web && bunx tsc --noEmit
```

Both must exit 0. Judge by exit status, not by scanning output text.

Optional sanity check that the whole build still typechecks: `bun run build` at the root (it runs the
root tsc + web tsc, then builds). Not required for this change.

## Out of scope — do not do

- No version bump in `herdr-plugin.toml` / `package.json` / `web/package.json`, no `CHANGELOG.md`
  entry. The release commit is cut afterwards. (Commit with `SKIP_VERSION_CHECK=1 git commit …` if the
  pre-commit hook objects.)
- No bridge changes — the snapshot already stamps `workspace.sssf`.
- No new dependencies.
- No change to the pane header's Traces button, `sssf-frame.tsx`, the Traces route, or `nav.ts`.
