# Plan — desktop mode, chunk 1a: the switch and the shell

**Repo:** `C:\claudeOS\Projects\tools\collie` (Windows, Git Bash)
**Branch:** `feat/desktop-shell` — already checked out, working tree clean at `9003293`.
**Version:** `0.55.2` → **`0.56.0`** (MINOR — a new surface and a new setting)
**Source of truth:** [`specs/desktop-mode-spec.md`](../../../../../specs/desktop-mode-spec.md) §1 and §2,
plus [`requests/desktop-1a-shell.md`](../../../../../requests/desktop-1a-shell.md).
Read the spec's **Decisions** table before you start. Do not re-open anything in it.

## What this chunk is

Collie is a phone UI. This chunk adds the *manual switch* that turns it into a desktop layout, and
the layout itself — nothing more. It is deliberately the boring half:

- a tiny store, `web/src/lib/desktop.ts`
- a Settings card that flips it
- a `DesktopShell` (sidebar + one pane, an off-ramp strip on top, no bottom bar)
- a `DesktopSidebar` (session switcher, the existing tree, a nav list)
- width tweaks on the routes that need them, and a "Pick a pane" empty state at `/`

Everything *inside* the pane view (hiding Keys / Type / attach / swipe / `PaneStrip`, the 2 h idle
pause, the `(n) Collie` tab title, the Ctrl+Alt+arrow hotkeys) is **chunk 1b** — a separate request
file on the same branch. Do not do it here.

The hard requirement that shapes every decision below: **with `on: false`, what renders must be
byte-for-byte what renders today.** Every existing test must pass with **no existing test file
edited**.

## Baseline — verified on this branch, 2026-08-22

Re-run these before you finish; the numbers are part of "done".

| Fact | Value |
|---|---|
| `bun run test` (root) | `839 pass, 20 skip, 0 fail` — **859 tests across 37 files** |
| `cd web && bun run test` | **120 files, 2681 passed \| 19 todo (2700)** |
| Version in all three files | `0.55.2` |
| Newest CHANGELOG heading | `## [0.55.2] - 2026-08-22` |

Also verified in the code (don't re-derive these):

- `web/src/routes/root.tsx` renders `<UpdateAvailableBanner/>` → `<ConnectionBanner/>` → `<Outlet/>`
  → `{showNav && <BottomNav …/>}` inside `<div className="flex h-[100dvh] flex-col">`.
- **The pane and history routes already have no `max-w-screen-sm`.** `agent-chat.tsx:598` is
  `max-w-[100dvw]`; `history.tsx:280` is `flex min-h-0 flex-1 flex-col`. Only **`files.tsx:30`**
  actually needs a width change in this chunk. `settings.tsx` and `traces.tsx` keep their
  `max-w-screen-sm` (a settings form in a 1400 px column is worse, and traces is out of scope).
- `HomeData` (`web/src/lib/loaders.ts:75`) has `workspaces`, `tabs`, `agents`, `shellPanes`,
  `sessions`, `session`, `device`, `files?: boolean`, `error`, `lastSeenAt`.
- `BottomNav` gates Traces on `data.workspaces.some(w => w.sssf)` and Files on `data.files === true`.
- `lib/haptics.ts` is the store pattern; `components/haptics-control.tsx` is the card pattern;
  `components/theme-control.tsx` is the `role="radiogroup"` segmented-control pattern.
- `StatusArea` is mounted by `routes/tree.tsx`, `routes/traces.tsx` and `components/agent-chat.tsx`
  — never by the root layout.
- Vitest has `globals: true`, so `describe/it/expect/vi` need no import (some files import them
  anyway; either is fine).
- `Monitor` is a real `lucide-react` export.

## Files to touch

| File | Change |
|---|---|
| `web/src/lib/desktop.ts` | **new** — the store |
| `web/src/lib/desktop.test.ts` | **new** — defaults + persistence |
| `web/src/components/desktop-control.tsx` | **new** — the Settings card (+ the two sub-rows) |
| `web/src/components/desktop-control.test.tsx` | **new** |
| `web/src/components/desktop-shell.tsx` | **new** — strip + two-column grid + `<Outlet/>` |
| `web/src/components/desktop-shell.test.tsx` | **new** |
| `web/src/components/desktop-sidebar.tsx` | **new** — switcher + tree + nav list |
| `web/src/components/desktop-sidebar.test.tsx` | **new** |
| `web/src/routes/root.tsx` | branch on `useDesktop().on` |
| `web/src/routes/root.test.tsx` — **do not edit**; add `web/src/routes/root-desktop.test.tsx` instead | new test file for the branch |
| `web/src/routes/settings.tsx` | mount `<DesktopControl/>`; hide `<HapticsControl/>` when on |
| `web/src/routes/tree.tsx` | "Pick a pane" empty state when on |
| `web/src/routes/files.tsx` | width class conditional on `on` |
| `web/src/components/space-tree.tsx` | **additive** optional `currentPaneId` prop (see §6) |
| `herdr-plugin.toml`, `package.json`, `web/package.json` | `0.55.2` → `0.56.0` |
| `CHANGELOG.md` | one `### Added` line under a new `## [0.56.0] - 2026-08-22` |

`space-tree.tsx` is not in the request's "Where" list, but "current pane row highlighted" cannot be
done from outside the component — the rows are `<button onClick={navigate(…)}>`, not links, so no CSS
selector can identify the current one. An optional prop that defaults to `undefined` changes nothing
when absent, which keeps the byte-for-byte rule and every existing `space-tree.test.tsx` case green.

---

## 1. `web/src/lib/desktop.ts` — the store

Copy the `lib/haptics.ts` shape. Two differences that matter, both called out below because getting
either wrong is the bug you will spend an hour on.

```ts
import { useSyncExternalStore } from "react";

// Desktop mode is a MANUAL per-browser switch, never an auto-detect: a phone in landscape and a
// laptop in a narrow window are the same viewport, and only the human knows which one has a
// keyboard. Layout AND control set follow this one boolean — no media query decides which controls
// exist (spec §1, "Decisions").

const STORAGE_KEY = "collie:desktop:v1";

export type TypingSurface = "composer" | "direct";
export interface DesktopPrefs {
  on: boolean;
  typing: TypingSurface;
}

/** Frozen so the server/never-loaded snapshot is one stable identity forever. */
const DEFAULTS: DesktopPrefs = Object.freeze({ on: false, typing: "composer" });

// Lazily loaded: `null` means "not read from storage yet". A test that seeds localStorage before the
// first read therefore sees its value, which a module-scope `load()` would have missed.
let prefs: DesktopPrefs | null = null;
const listeners = new Set<() => void>();

function load(): DesktopPrefs {
  try {
    if (typeof localStorage === "undefined") return DEFAULTS;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DesktopPrefs>;
    return {
      on: parsed.on === true,
      typing: parsed.typing === "direct" ? "direct" : "composer",
    };
  } catch {
    return DEFAULTS; // private mode / SSR / corrupt JSON
  }
}

// IDENTITY IS THE CONTRACT. useSyncExternalStore compares getSnapshot() results with Object.is and
// re-renders forever if a fresh object comes back each call — so this caches and only ever swaps the
// object in a setter.
function snapshot(): DesktopPrefs {
  return (prefs ??= load());
}

function write(next: DesktopPrefs): void {
  prefs = next;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota / SSR write errors — the in-memory value still applies for this session.
  }
  for (const fn of listeners) fn();
}

export function desktopPrefs(): DesktopPrefs {
  return snapshot();
}

export function setDesktop(on: boolean): void {
  write({ ...snapshot(), on });
}

export function setTyping(typing: TypingSurface): void {
  write({ ...snapshot(), typing });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reactive read. Every desktop branch in the app goes through this one hook. */
export function useDesktop(): DesktopPrefs {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULTS);
}

/** Test seam — back to a never-read store, exactly as on a fresh browser. */
export function __resetDesktop(): void {
  prefs = null;
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  for (const fn of listeners) fn();
}
```

Do not export a `desktopOn()` convenience alongside `desktopPrefs()`. One reader, one hook.

## 2. `web/src/components/desktop-control.tsx` — the Settings card

Same skeleton as `haptics-control.tsx` (Card → `p-4` row → icon + title + description → Switch in a
fixed `h-6 w-11` slot). No `supported()` gate — every browser can render a sidebar.

- Icon: `Monitor` from `lucide-react`.
- Title: `Desktop mode`
- Description: `Sidebar layout and direct keyboard typing. For a computer, not a phone.`
- `<Switch checked={on} onCheckedChange={setDesktop} aria-label="Desktop mode" />`

When `on`, two more rows render inside the same `<Card>`, each separated by
`border-t border-border/60` like the push card's note row:

1. **Typing surface** — the `theme-control.tsx` segmented control, copied down to the class names:
   `role="radiogroup" aria-label="Typing surface"`, two `role="radio"` buttons `Composer` and
   `Direct`, `aria-checked` on the selected one, `onClick={() => setTyping("composer" | "direct")}`.
   Add a one-line note under it: `Direct sends every key straight to the terminal.` (The behaviour
   is phase 2; the pref is stored now. Say nothing here that promises it already works.)
2. **Idle pause** — read-only text, no control:
   `2 h on desktop. Pauses polling; it does not lock the shell — use your OS screen lock.`
   Wrap it as `<p className="border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">`.
   It is honest about ADR 0007: the idle cover is a pause, not a security gate. (The 2 h value lands
   in chunk 1b; the copy is written now because it is what the row is *for*.)

## 3. `web/src/routes/settings.tsx`

Two edits, nothing else:

```tsx
const { on } = useDesktop();
…
<ThemeControl />
<DesktopControl />
{!on && <HapticsControl />}
```

`DesktopControl` sits directly under `ThemeControl` — both answer "how does this machine treat me",
and it must be reachable without scrolling past the notification stack. Haptics is hidden when `on`
because a desktop has no vibration motor and a toggle that provably does nothing teaches the user
the app lies (the same reasoning already written at the top of `haptics-control.tsx`).

Leave `settings.tsx`'s `max-w-screen-sm` alone.

## 4. `web/src/components/desktop-shell.tsx`

```tsx
interface DesktopShellProps {
  data: HomeData;
  /** The pane on screen, so the sidebar can light its row. Undefined off a pane route. */
  currentPaneId?: string;
}

export function DesktopShell({ data, currentPaneId }: DesktopShellProps) {
  return (
    <>
      {/* Off-ramp. ALWAYS visible, never collapsible: a phone user who flips the switch out of
          curiosity must not have to find Settings inside a 280px sidebar on a 390px screen. */}
      <div className="flex shrink-0 items-center justify-center gap-2 border-b border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
        <span>Desktop mode is on</span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => setDesktop(false)}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Turn off
        </button>
      </div>

      {/* minmax(0,1fr), not 1fr: a grid track's default min-width is `auto`, so a wide terminal line
          would push the pane column past the viewport and knock the sidebar off screen. */}
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-r-2 border-border bg-muted/30">
          <DesktopSidebar data={data} currentPaneId={currentPaneId} />
        </aside>
        {/* A plain div, NOT <main>: routes/tree.tsx and routes/settings.tsx each render their own
            <main>, and nesting one inside another is invalid HTML and breaks getByRole("main"). */}
        <div className="flex min-h-0 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>
    </>
  );
}
```

`DesktopShell` is a fragment, not a wrapper `<div>` — it slots straight into `RootLayout`'s existing
`flex h-[100dvh] flex-col`, so the two banners stay in-flow rows *above* both columns exactly as they
are today (that in-flow placement is what stops a banner covering a route's sticky header).

Do not add `useDesktopHotkeys()` here — that is chunk 1b.

## 5. `web/src/routes/root.tsx`

```tsx
const { on } = useDesktop();
…
return (
  <div className="flex h-[100dvh] flex-col">
    <UpdateAvailableBanner />
    <ConnectionBanner … />
    {on ? (
      <DesktopShell data={data} currentPaneId={paneId} />
    ) : (
      <>
        <Outlet />
        {showNav && <BottomNav session={data.session} traces={anyTraces} files={data.files === true} />}
      </>
    )}
  </div>
);
```

`paneId` and `showNav`/`anyTraces` already exist in the component. Keep `showNav` computed
unconditionally — it costs nothing and keeps the phone branch textually identical to today.

## 6. `web/src/components/desktop-sidebar.tsx`

Three stacked regions inside the `aside`. Takes `data: HomeData` and `currentPaneId?: string` as
props (not `useRouteLoaderData`) so a test can render it under a bare `MemoryRouter`.

```tsx
export function DesktopSidebar({ data, currentPaneId }: DesktopSidebarProps) {
  const revalidator = useRevalidator();
  const { newSpace, newTab } = useSpaceActions();
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  …
}
```

**Top** — a short header row: the Collie wordmark/mark and `<SessionSwitcher sessions={data.sessions ?? []} current={data.session} />`. `SessionSwitcher` already renders nothing when there is no real choice, so a single-session install just shows the mark.

**Middle** — the tree, scrolling, in a `flex min-h-0 flex-1 flex-col overflow-y-auto`:

```tsx
<SpaceTree
  workspaces={data.workspaces}
  tabs={data.tabs}
  agents={data.agents}
  shellPanes={data.shellPanes}
  onNewSpace={() => setNewSpaceOpen(true)}
  onNewTab={newTab}
  session={data.session}
  readOnly={isReadOnly(data.device)}
  onRenamed={() => revalidator.revalidate()}
  error={data.error}
  lastSeenAt={data.lastSeenAt}
  currentPaneId={currentPaneId}
/>
```

Same wiring as `routes/tree.tsx`, plus the new prop. Mount `<NewSpaceSheet open={newSpaceOpen} … onCreate={newSpace} />` at the end of the sidebar so "new space" still works from here.

**Bottom** — a vertical nav list, `shrink-0`, `border-t-2 border-border`, one row per destination:

```tsx
const items = [
  { key: "spaces", label: "Spaces", icon: LayoutGrid, to: homePath(data.session), on: pathname === "/" },
  ...(data.workspaces.some((w) => w.sssf)
    ? [{ key: "traces", label: "Traces", icon: Activity, to: tracesPath(data.session), on: pathname.startsWith("/traces") }]
    : []),
  ...(data.files === true
    ? [{ key: "files", label: "Files", icon: Folder, to: filesPath(data.session), on: pathname.startsWith("/files") }]
    : []),
  { key: "settings", label: "Settings", icon: Settings, to: settingsPath(data.session), on: pathname === "/settings" },
];
```

Rows are `<button type="button" aria-current={it.on ? "page" : undefined} onClick={() => { if (!it.on) navigate(it.to, { replace: true }); }}>` with icon + label, left-aligned, `min-h-10`.
`replace`, same as `BottomNav`: a nav list switches sections, it does not drill down.

This item array is a deliberate ~10-line twin of the one in `bottom-nav.tsx`. Leave a comment saying
so and pointing at that file. Extracting a shared builder means editing `bottom-nav.tsx`, which is
outside this chunk and puts the "phone renders byte-for-byte what it renders today" guarantee at
risk for no gain — the two lists differ in orientation, sizing and the safe-area padding.

### `space-tree.tsx` — the additive prop

1. `SpaceTreeProps` gains:
   ```ts
   /** The pane currently on screen (desktop sidebar). Undefined on the phone: nothing highlights. */
   currentPaneId?: string;
   ```
   and the destructure gains `currentPaneId`.
2. `TreeRowButtonProps` gains `current?: boolean`, and the button renders
   `aria-current={current ? "page" : undefined}` plus `current && "font-medium text-foreground"`
   inside the existing `cn(...)`.
3. Level-3 pane row (~line 368) — the wrapper `<div key={p.paneId} className="flex flex-row items-center gap-1 py-1 pr-1.5">` becomes
   `cn("flex flex-row items-center gap-1 py-1 pr-1.5", p.paneId === currentPaneId && "rounded bg-muted")`,
   and its `TreeRowButton` gets `current={p.paneId === currentPaneId}`.
4. Level-2 tab row (~line 311) — the same treatment, but only for a **single-pane** tab, because that
   row *is* the pane (it opens it rather than expanding):
   `const tabIsCurrent = tabPanes.length === 1 && tabPanes[0]!.paneId === currentPaneId;`

With `currentPaneId` undefined, both comparisons are false and every class string is what it is
today. That is the whole point — verify it by running `space-tree.test.tsx` unchanged.

## 7. Route width and the empty state

**`web/src/routes/files.tsx:30`** — the only real width change:

```tsx
const { on } = useDesktop();
…
<div className={cn("mx-auto flex min-h-0 w-full flex-1 flex-col", !on && "max-w-screen-sm")}>
```

Import `cn` from `@/lib/utils` (the file does not import it yet). Both the error-branch return and
the main return are in this file; the error branch has no `max-w-screen-sm`, so leave it.

**`web/src/routes/tree.tsx`** — the index route. The tree already lives in the sidebar, so `/` must
not render it twice. After the existing hook calls (hooks first, always), return the empty state:

```tsx
if (on) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 items-center justify-center p-6 text-muted-foreground">
        Pick a pane
      </div>
      {/* Keeps rename/close toasts from the sidebar's action sheets visible on this screen —
          agent-chat mounts its own StatusArea, so no route ever shows two. */}
      <div className="pointer-events-none z-30 px-3 pb-3">
        <StatusArea />
      </div>
    </div>
  );
}
```

**Pane and history need no edit.** Confirm with
`grep -n "max-w-screen-sm" web/src/routes/history.tsx web/src/components/agent-chat.tsx` — expect no
matches. `agent-chat.tsx`'s `max-w-[100dvw]` is a phone overflow clamp that never binds inside the
grid column; leave it.

---

## 8. Tests

Four new files. **Edit no existing test file.** Every new test seeds state through
`__resetDesktop()` in `beforeEach` *and* `afterEach` — the store is module-scoped, so a leaked `on:
true` would poison an unrelated file later in the run.

### `web/src/lib/desktop.test.ts`
- **Defaults snapshot** (the request names this explicitly):
  `expect(desktopPrefs()).toEqual({ on: false, typing: "composer" })`.
- `setDesktop(true)` then `localStorage.getItem("collie:desktop:v1")` parses to `{on:true,typing:"composer"}`.
- `setTyping("direct")` keeps `on` where it was.
- A value already in `localStorage` before the first read wins (proves lazy load).
- Corrupt JSON, and `{"typing":"nonsense"}`, both fall back to the defaults without throwing.
- `snapshot()` identity is stable across calls and changes after a setter — the guard against the
  `useSyncExternalStore` infinite loop. `expect(desktopPrefs()).toBe(desktopPrefs())`.

### `web/src/components/desktop-control.test.tsx`
- Renders with the Switch unchecked by default; clicking it makes `desktopPrefs().on` true.
- The "Typing surface" radiogroup and the "Idle pause" text are **absent** while off, present while
  on; clicking `Direct` sets `typing`.

### `web/src/components/desktop-sidebar.test.tsx`
Render under `MemoryRouter` with a hand-built `HomeData` (copy the `connected()` helper shape from
`routes/detail.test.tsx`).
- Nav rows are exactly `["Spaces", "Settings"]` with `files: false` and no `sssf` workspace, and
  `["Spaces", "Traces", "Files", "Settings"]` with both on — the same gating `BottomNav` uses.
- Clicking `Settings` navigates to `/settings` (use a `LocationProbe` like `bottom-nav.test.tsx`).
- With `currentPaneId` set to a pane in the tree, exactly one element has `aria-current="page"`
  among the tree rows; with it undefined, none do.

### `web/src/routes/root-desktop.test.tsx`
The important one. `vi.mock` the four side-effecting hooks so the layout is all that runs:
`@/hooks/use-polling`, `@/hooks/use-poll-busy`, `@/hooks/use-transitions`, `@/hooks/use-push`
(each to a no-op export). Build a `createMemoryRouter` with `ROOT_ROUTE_ID`, a loader returning a
`HomeData`, `element: <RootLayout />`, and an index child.

- **`on: false` (the guarantee):** `BottomNav` is in the tree (`getByRole("navigation", { name: "Main" })`, or the Spaces/Settings buttons); `queryByText(/Desktop mode is on/)` is null; `queryByRole("button", { name: "Turn off" })` is null; no `<aside>` in the container.
- **`on: true`:** `getByText(/Desktop mode is on/)` and the `Turn off` button are present; an
  `<aside>` exists; the `Main` bottom nav is **not** in the tree.
- Clicking `Turn off` flips `desktopPrefs().on` to false and the bottom nav comes back in the same
  render — no reload.

## 9. Version and CHANGELOG

`0.55.2` → `0.56.0` in **`herdr-plugin.toml`** (line 3), **`package.json`** (line 3),
**`web/package.json`** (line 3). MINOR: a capability exists that did not; nothing an existing
operator has configured changes.

New heading at the top of the entries in `CHANGELOG.md`:

```markdown
## [0.56.0] - 2026-08-22

### Added
- Desktop mode (Settings toggle): sidebar + pane layout
```

Exactly that line, exactly that wording. Chunk 1b **appends a second line to this same 0.56.0
entry** — do not cut a new version for it. The house style asks for a short commit hash at the end
of a feature line; add it when the release commit is cut, once 1a and 1b are both in.

Then `bash scripts/check-version.sh` must print `✓`. The pre-commit hook enforces this anyway — any
change under `web/src/` without a matching bump is refused (`SKIP_VERSION_CHECK=1` exists but is not
for this).

## 10. Verify

```bash
bun run typecheck                # root tsc + web tsc, both strict, noUnusedLocals/Parameters
bun run test                     # expect: 859 tests across 37 files, 0 fail — UNCHANGED
cd web && bun run test           # expect: 2681 existing passed + 19 todo, 0 fail, plus the new files
bash scripts/check-version.sh    # expect: ✓
```

`bun run typecheck` at the root runs both sides. Judge each command by its **exit status**, not by
grepping its output for the word "error".

Reading the counts: the root suite must be *identical* (859/37 — this chunk touches no `bridge/`
code). The web suite must keep all **2681** existing tests passing and the todo count at **19**; the
new files push the totals up (~120 → 124 files). If an existing web test starts failing, the cause is
almost always the module-scoped store leaking `on: true` across files — fix the `__resetDesktop()`
in the offending new file, never the old test.

Then eyeball it for real:

```bash
bun run build                    # typechecks both sides, builds to dist-staging, swaps atomically
```

The bridge serves `web/dist` from disk at request time, so on this box the rebuild is live with no
restart — but **nothing rebuilds it for you**. Open Collie in a desktop browser, flip the switch in
Settings, confirm the sidebar + strip, click `Turn off`, confirm the tree comes back looking exactly
as it did.

## 11. Traps, in the order you will hit them

1. **`useSyncExternalStore` + an object snapshot.** Return a fresh `{on, typing}` from `getSnapshot`
   and React loops until the tab dies. The cached `prefs ??= load()` in §1 is the fix; the identity
   test in §8 is the guard.
2. **Nested `<main>`.** `DesktopShell`'s right column is a `<div>`. `routes/tree.tsx` and
   `routes/settings.tsx` already render `<main>` inside it.
3. **`grid-cols-[280px_1fr]`.** A `1fr` track's implicit `min-width: auto` lets a wide terminal line
   blow the layout out. Use `minmax(0,1fr)`.
4. **Editing an existing test file.** If a change makes one fail, the change is wrong. The only
   sanctioned edit to shipped code that existing tests see is the additive `currentPaneId` prop, and
   it is inert when undefined.
5. **Doing chunk 1b.** No `document.title`, no `useIdleLock` duration change, no hotkeys, no hiding
   anything inside the pane view, no `App.tsx` edit. Those are `requests/desktop-1b-phone-bits.md`.
6. **Forgetting the bump.** The pre-commit hook will stop you, which is the point, but fixing it
   after the fact means an amend or a second commit.

## 12. Out of scope (from the request, verbatim in effect)

`web/src/hooks/use-display-prefs.ts` (the spec says untouched) · anything in `bridge/` ·
`use-direct-typing.ts`, `composer.tsx`, `use-long-press.ts` (phases 2–3) · idle-lock duration,
`document.title`, hotkeys, and hiding Keys / Type / attach / swipe / `PaneStrip` / haptics /
`tapToFocus` inside the pane view (chunk 1b) · any resizable or collapsible sidebar · auto-detect by
viewport · `setAppBadge` · split panes · resizing the real Herdr pane.

## 13. Landing it

Stay on `feat/desktop-shell`. Commit this chunk on its own (`feat: desktop mode switch and shell`),
then chunk 1b lands on the same branch, then one PR:
`git push -u origin feat/desktop-shell && gh pr create`. The pre-push hook runs both suites
(the Windows lifecycle suite takes the PowerShell branch automatically — no `SKIP_TESTS=1`).
The `v0.56.0` tag is pushed when the release is actually cut, not now.
