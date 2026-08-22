# Plan — desktop mode 1a follow-up: four gaps in commit `1dae038`

**Repo:** `C:\claudeOS\Projects\tools\collie` (Windows, Git Bash)
**Branch:** `feat/desktop-shell` — already checked out, clean at `809b6b3`.
**Version:** stays **0.56.0**. No version bump, no CHANGELOG entry. (`1dae038` already cut 0.56.0;
this is finishing the same release before it ships.)
**Request:** `requests/desktop-1a-fix.md` · original `requests/desktop-1a-shell.md` ·
spec `specs/desktop-mode-spec.md` §2 and §9 · the 1a plan `specs/4631ac3f_desktop-switch-shell.md`.

Four gaps, all in `web/`. Nothing in `bridge/`. The rule that governs every edit:

> **With `useDesktop().on === false`, what renders must be byte-for-byte what rendered at `9003293`.**
> No existing test file may be edited.

---

## Facts verified in the code today (2026-08-22) — don't re-derive

| Fact | Value |
|---|---|
| Root suite | `bun run test` at repo root → **859 tests / 37 files** (no bridge change here, so it can't move) |
| Web suite | `cd web && bun run test` (`tsc --noEmit` ×2 then `vitest run`) |
| Store | `web/src/lib/desktop.ts` exports `useDesktop()`, `desktopPrefs()`, `setDesktop()`, `setTyping()`, `__resetDesktop()`; key `collie:desktop:v1`; defaults `{ on: false, typing: "composer" }` |
| Pane route | `web/src/routes/detail.tsx` renders `<AgentChat/>` with **no wrapper div** — the pane's outermost element and its width class live in **`web/src/components/agent-chat.tsx:598`** |
| `agent-chat.tsx:598` at `9003293` | `className="flex min-h-0 w-full min-w-0 max-w-[100dvw] flex-1 flex-col overflow-x-hidden"` |
| `history.tsx:280` at `9003293` | `className="flex min-h-0 flex-1 flex-col"` — **no width cap at all** |
| `files.tsx:30` at `9003293` | `className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col"` (1dae038 deleted `max-w-screen-sm` unconditionally — that is gap 1) |
| Tree wiring to copy | `web/src/routes/tree.tsx` lines 22–26 and 46–54 and the trailing `<NewSpaceSheet …/>` |
| `SpaceTree` affordances | buttons with `aria-label="New space"` (line 185) and `aria-label="New tab"` (line 406) |
| `BottomNav` gating | `traces={data.workspaces.some(w => w.sssf)}`, `files={data.files === true}`; the nav element is `<nav aria-label="Main">` |
| `DesktopSidebar` nav | `<nav aria-label="Desktop navigation">` |
| MSW create fixtures | `POST /api/workspace` → pane `w9:p1`; `POST /api/tab` → pane `w2:p9` (`web/src/test/handlers.ts`) |
| Vitest | `globals: true`, jsdom, setup at `web/src/test/setup.ts` (clears `localStorage` before each test) |

**Note on the request's file path.** `requests/desktop-1a-fix.md` says "the pane route
(`web/src/routes/agent-chat.tsx`)". That file does not exist. The pane route is
`routes/detail.tsx`, and the element that carries the width class is
`components/agent-chat.tsx`. Edit **`web/src/components/agent-chat.tsx`**. Do *not* add a wrapper
`<div>` in `detail.tsx` — an extra DOM node when `on: false` breaks the byte-for-byte rule.

---

## The width pattern to use everywhere (decided — don't improvise)

Use a **plain ternary between two literal class strings**, not `cn()` with a conditional:

```tsx
className={desktop ? "<desktop string>" : "<the exact 9003293 string>"}
```

Why not `cn(...)`: `cn` is `clsx` + `tailwind-merge`, so an appended conditional changes the **order**
of classes in the emitted `class` attribute even when the set is identical. The acceptance rule here
is "exactly what it was", and a ternary makes that literally checkable by `git diff` — the off-branch
string is copy-pasted, not computed. It also costs no new import.

---

## Task 1 — `web/src/routes/files.tsx`: restore the phone width cap

Line 30. Add the store read at the top of `FilesRoute` (next to the other hooks, above the early
`if (loaded.error …)` return so hook order is unconditional):

```tsx
import { useDesktop } from "@/lib/desktop";
…
const desktop = useDesktop().on;
```

Then the wrapper:

```tsx
return <div className={desktop ? "mx-auto flex min-h-0 w-full flex-1 flex-col" : "mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col"}>
```

Add a one-line comment above it:

```tsx
// Phone keeps the 640px reading column; desktop mode fills the pane column of the shell grid
// (the sidebar already takes 280px, so a second cap would waste most of the screen).
```

Existing `files.test.tsx` renders with the store untouched → `on: false` → the class string is
identical to `9003293`. Do not edit that test file.

## Task 2 — the pane route and the history route

### 2a. `web/src/components/agent-chat.tsx` (line 598)

The only phone-width cap on this element is `max-w-[100dvw]`. Inside the desktop grid the column is
narrower than the viewport, so a `100dvw` cap constrains nothing it should and is exactly the
"phone assumes it owns the viewport" class the spec means. Drop it when `on`:

```tsx
const desktop = useDesktop().on;   // near the other hooks at the top of AgentChat
…
<div className={desktop
  ? "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden"
  : "flex min-h-0 w-full min-w-0 max-w-[100dvw] flex-1 flex-col overflow-x-hidden"}>
```

Comment above it:

```tsx
// max-w-[100dvw] is a phone guard (the mirror must never widen the page). In desktop mode the
// grid track (minmax(0,1fr)) is the constraint and the viewport is not this element's width.
```

`AgentChat` is a big component: put `const desktop = useDesktop().on;` with the other top-level
hooks, never inside a branch. **Touch nothing else in this file** — `use-direct-typing.ts`,
`composer.tsx`, `PaneStrip`, the swipe handle and `tapToFocus` are chunk 1b and out of scope.

### 2b. `web/src/routes/history.tsx` (line 280) — leave the class string alone

`git show 9003293:web/src/routes/history.tsx | sed -n 280p` is `flex min-h-0 flex-1 flex-col`:
**the history route has never had a width cap.** There is nothing to drop, and *adding*
`max-w-screen-sm` so it can be conditionally removed would change the phone — the one thing the
request forbids ("when `on` is false the class list is exactly what it was at 9003293").

So the code change here is a comment that records the check, so the next reader doesn't re-open it:

```tsx
// No width cap here by design: history has always been full-width, so desktop mode has nothing
// to drop (spec §2 lists this route only because files.tsx and the pane did carry one).
```

Pin it with a test instead (Task 4c) so "history is uncapped in both modes" is asserted, not assumed.
Do **not** import `useDesktop` into `history.tsx` — an unused import fails `noUnusedLocals`.

## Task 3 — `web/src/components/desktop-sidebar.tsx`: real create handlers

Today: `onNewSpace={() => {}}` and `onNewTab={() => {}}` — the "New space" / "New tab" buttons in the
sidebar tree are dead. Wire them exactly as `routes/tree.tsx` does:

```tsx
import { useState } from "react";
import { useLocation, useNavigate, useRevalidator } from "react-router";
import { NewSpaceSheet } from "@/components/new-space-sheet";
import { useSpaceActions } from "@/hooks/use-spaces";
…
export function DesktopSidebar({ data, currentPaneId }: { data: HomeData; currentPaneId?: string }) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { newSpace, newTab } = useSpaceActions();
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const { pathname } = useLocation();
  …
```

In the `<SpaceTree …/>` call replace the two stubs and add the revalidate-on-rename that `tree.tsx`
passes (same wiring line; without it a rename done from the sidebar doesn't refresh the tree):

```tsx
onNewSpace={() => setNewSpaceOpen(true)}
onNewTab={newTab}
onRenamed={() => revalidator.revalidate()}
```

Mount the dialog as the last child of the `<aside>`, after the `<nav>`:

```tsx
<NewSpaceSheet open={newSpaceOpen} onClose={() => setNewSpaceOpen(false)} onCreate={newSpace} />
```

`useSpaceActions` reads `ROOT_ROUTE_ID` loader data for read-only + session and handles the
navigate-into-the-fresh-pane flow itself — do not re-implement any of that here.

## Task 4 — the missing tests (three new files, no existing file edited)

All three files must isolate the module-scoped store:

```ts
import { __resetDesktop, setDesktop, desktopPrefs } from "@/lib/desktop";
beforeEach(() => __resetDesktop());
afterEach(() => __resetDesktop());
```

(`setup.ts` clears `localStorage`, which does **not** clear `lib/desktop.ts`'s cached module value.
Vitest isolates per file, so leakage is only a within-file risk — but reset anyway.)

Every harness needs a **data router** (`createMemoryRouter` + `RouterProvider`): `useRevalidator`
and loader data don't exist under a bare `<MemoryRouter>`. Copy the shape from
`web/src/routes/files.test.tsx:12-15`.

A reusable `HomeData` fixture for all three (vary `workspaces`/`files` per case):

```ts
const home: HomeData = { bridge: "connected", agents: [], shellPanes: [], workspaces: [], tabs: [],
  device: undefined, sessions: [], session: undefined, snoozedUntil: null, update: undefined,
  error: false, authError: false };
```

### 4a. `web/src/routes/root-desktop.test.tsx` — the branch in `RootLayout`

Harness: root route `{ id: ROOT_ROUTE_ID, path: "/", loader: () => home, element: <RootLayout/>,
children: [{ index: true, element: <div>tree stand-in</div> }] }`, `initialEntries: ["/"]`.
(`RootLayout` runs `usePolling` / `usePushSetup` / `useAgentTransitions`; all of them no-op or
revalidate the local loader under jsdom + MSW — no mocking needed. If push logs a warning, ignore it.)

Cases:

1. **`on: false` — the phone shell.** Render.
   - `screen.getByRole("navigation", { name: "Main" })` is in the document (`BottomNav`).
   - `screen.queryByRole("navigation", { name: "Desktop navigation" })` is null (no sidebar).
   - `screen.queryByText(/Desktop mode is on/)` is null (no strip).
   - `screen.queryByRole("button", { name: "Turn off" })` is null.
2. **`on: true` — the desktop shell.** `setDesktop(true)` **before** `render`.
   - the sidebar nav and the strip are present; `queryByRole("navigation", { name: "Main" })` is null.
3. **"Turn off" is the off-ramp.** With `on: true` rendered, `fireEvent.click(screen.getByRole("button",
   { name: "Turn off" }))`, then:
   - `desktopPrefs().on` is `false`;
   - `await screen.findByRole("navigation", { name: "Main" })` — the bottom bar is back;
   - the strip and the sidebar are gone. (The store notifies via `useSyncExternalStore`, so the flip
     re-renders in place; wrap the click in `act` only if RTL complains.)

### 4b. `web/src/components/desktop-sidebar.test.tsx` — gating + the create handlers

Harness: a data router whose root route has `id: ROOT_ROUTE_ID`, `loader: () => home`, and an element
that renders `<DesktopSidebar data={home} />` plus an `<Outlet/>`; add a `/pane/:paneId` child with a
trivial element so a create-navigation lands somewhere.

Cases:

1. **Nav gating matches `BottomNav`.** With `workspaces: []` and `files` unset: nav items are exactly
   `Spaces` and `Settings`; `queryByRole("button", { name: "Traces" })` and `{ name: "Files" }` are
   null. With `workspaces: [{ …, sssf: true }]` → `Traces` appears. With `files: true` → `Files`
   appears. Assert both directions, since a truthiness bug (`data.files` vs `data.files === true`)
   only shows on one side. Build the workspace fixture from the `WorkspaceView` type in
   `web/src/lib/types.ts` — fill every required field rather than casting.
2. **"New space" opens the dialog.** `fireEvent.click(screen.getByLabelText("New space"))` →
   `await screen.findByText("New space")` heading / the "Directory (optional)" field of
   `NewSpaceSheet` is on screen. Then submit it and assert the router navigated to `/pane/w9:p1`
   (the MSW `POST /api/workspace` fixture) — that proves `onCreate={newSpace}` is the real handler,
   which an empty-arrow stub could never do.
3. **"New tab" creates a tab.** Only if the `New tab` button is reachable without fighting the
   tree's expansion state: give `home` one workspace with one tab, expand the space row if needed,
   click `getByLabelText("New tab")` and assert the router navigated to `/pane/w2:p9` (the MSW
   `POST /api/tab` fixture). If expansion turns out to need more setup than the assertion is worth,
   drop this case and leave a one-line comment saying `newTab` is covered by the same
   `useSpaceActions()` wiring as case 2.

### 4c. `web/src/components/desktop-shell.test.tsx` — the shell's own contract

Harness: root route `id: ROOT_ROUTE_ID`, `loader: () => home`, `element: <DesktopShell/>`, with
children `{ index: true, element: <div>pane stand-in</div> }`.

Cases:

1. The strip renders "Desktop mode is on" and a `Turn off` button, and the `<Outlet/>` child renders
   (the stand-in text is on screen) — i.e. the shell doesn't swallow the route.
2. The sidebar (`nav` "Desktop navigation") renders inside it.
3. **Width rule pinned:** render the files route (or assert on the rendered container) with
   `on: true` and with `on: false` and check the wrapper's `class`:
   `expect(el.className).not.toMatch(/max-w-screen-sm/)` when on, and `toContain("max-w-screen-sm")`
   when off. If that reads more naturally beside the route, put it in a new
   `web/src/routes/files-desktop.test.tsx` instead — either is fine, but **do not edit
   `files.test.tsx`**.
4. **History stays uncapped in both modes** (records Task 2b): render the history route with `on`
   false and again with `on` true and assert its wrapper `className` matches no `max-w-` in either.
   Reuse the harness in the existing `web/src/routes/history.test.tsx` as a model (read it; don't
   edit it). If mounting that route needs more fixture than the assertion is worth, drop this case —
   the comment from Task 2b is then the only record, which is acceptable. Never assert against the
   source text of a file instead of its rendered output.

Keep every new test file in the existing house style: no `import { describe … } from "vitest"` needed
(`globals: true`), Testing Library queries by role/label over `container.querySelector` except where
a class is the thing under test.

---

## Verification (all must pass before you stop)

```bash
cd web && bun run test          # typecheck ×2 + vitest; new tests added, no existing test file edited
cd .. && bun run test           # 859 tests / 37 files, unchanged
bun run typecheck               # root tsc clean
bash scripts/check-version.sh   # prints ✓ at 0.56.0
git diff --stat                 # only the six files below
```

Also confirm by hand that the off-branch is byte-identical:

```bash
git diff 9003293 -- web/src/routes/history.tsx        # comment only
git diff 9003293 -- web/src/routes/files.tsx web/src/components/agent-chat.tsx
# every removed class must reappear verbatim in the `: "…"` branch
```

## Files this change may touch

| File | Change |
|---|---|
| `web/src/routes/files.tsx` | restore `max-w-screen-sm`, drop it only when `on` |
| `web/src/components/agent-chat.tsx` | drop `max-w-[100dvw]` only when `on` |
| `web/src/routes/history.tsx` | one comment (no class change) |
| `web/src/components/desktop-sidebar.tsx` | real `useSpaceActions()` wiring + `NewSpaceSheet` + `onRenamed` |
| `web/src/routes/root-desktop.test.tsx` | **new** |
| `web/src/components/desktop-sidebar.test.tsx` | **new** |
| `web/src/components/desktop-shell.test.tsx` | **new** (optionally plus `web/src/routes/files-desktop.test.tsx`) |

## Out of scope — do not touch

- `web/src/hooks/use-display-prefs.ts`, anything under `bridge/`.
- `web/src/hooks/use-direct-typing.ts`, `web/src/components/composer.tsx`,
  `web/src/hooks/use-long-press.ts`.
- Everything in `requests/desktop-1b-phone-bits.md`: the 2 h idle pause, `document.title`, the
  Ctrl+Alt hotkeys, and hiding Keys / Type / attach / swipe / `PaneStrip` / haptics / `tapToFocus`
  inside the pane view.
- `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md` — version stays 0.56.0
  and the CHANGELOG entry for it already exists. (The pre-commit hook may object that functional code
  changed without a bump; this is the intended case for `SKIP_VERSION_CHECK=1 git commit …`, because
  0.56.0 has not shipped yet and this work belongs to it.)
- Any restyle of the shell grid, the strip, the Settings card, or `space-tree.tsx` — `1dae038`'s
  choices there are not among the four gaps.

## Commit

One commit on `feat/desktop-shell`, e.g.
`fix(desktop): keep phone widths off desktop, wire sidebar creates, add branch tests`.
Do not tag; the release goes out when 1b lands.
