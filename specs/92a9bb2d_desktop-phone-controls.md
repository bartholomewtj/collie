# Plan — desktop mode phase 1, finish (phone-only controls, idle, title, hotkeys)

**Repo:** `C:\claudeOS\Projects\tools\collie` (Windows checkout, Git Bash)
**Branch:** `feat/desktop-shell` — already checked out, tree clean at `4dfa259`.
**Version:** 0.56.0 → **0.56.1** (PATCH, as instructed).
**Source spec:** `specs/desktop-mode-spec.md` §2, §5, §6, §9. Its **Decisions** table is settled —
read it, do not re-open any row.

There is an earlier plan for the same request at `specs/77379882_desktop-phase1-controls.md`. It was
written before the request was corrected (commit `4dfa259` took `composer.tsx` off the deny-list).
This plan supersedes it. Nothing from it was implemented — `git log` shows no code commit after the
spec commit.

---

## What already exists on this branch — verified, do not rebuild

| File | State |
|---|---|
| `web/src/lib/desktop.ts` | The store. `useDesktop() → { on, typing }`, `setDesktop`, `setTyping`, `desktopPrefs()`, `__resetDesktop()`. Key `collie:desktop:v1`. |
| `web/src/components/desktop-shell.tsx` | Off-ramp strip + 280 px sidebar + `<Outlet/>`. Already reads `data` (root loader) and `paneId`. |
| `web/src/components/desktop-sidebar.tsx` | Tree + session switcher + `nav aria-label="Desktop navigation"`. |
| `web/src/components/desktop-control.tsx` | The Settings card (Desktop mode switch, Typing surface, Idle pause note). |
| `web/src/routes/root.tsx` | Already swaps `<DesktopShell/>` in for `<Outlet/>` and drops `BottomNav` when on. `const desktop = useDesktop().on;` is already there. |
| `web/src/routes/settings.tsx` | Already hides `HapticsControl` when on. |
| `web/src/routes/tree.tsx`, `routes/files.tsx`, `components/agent-chat.tsx` | Already drop `max-w-screen-sm` / the `max-w-[100dvw]` phone guard when on. `agent-chat.tsx:598` already has `const desktop = useDesktop().on;`. |
| Tests | `routes/root-desktop.test.tsx`, `components/desktop-shell.test.tsx`, `components/desktop-sidebar.test.tsx`, `lib/desktop.test.ts`. |

---

## Two corrections to the request's file list — read before you start

**a. The Keys / Type controls and the attach button are in `composer.tsx`, not `nav-tray.tsx`.**
The request says "the Keys and Type controls in the Controls row (`nav-tray.tsx`)". Wrong file.
`web/src/components/nav-tray.tsx` is the *keys pad itself* — the thing the Keys dock mounts. The
**Controls row** (`Keys · Type · Quick · ⚙`) is in `web/src/components/composer.tsx` at ~lines
794–860; the attach-image button is in the same file at ~987–1005.

→ **Do not edit `nav-tray.tsx`.** It needs no change: with the Keys button hidden the dock can never
open. **Do edit `composer.tsx`** — the request explicitly puts "only hiding the attach button" in
scope there, and the Keys/Type hides have nowhere else to live.

**b. The `tapToFocus` pref row is not in the Settings route.**
It lives in `web/src/components/display-prefs.tsx` (`DisplayPrefsContent`), which the composer's ⚙
dock mounts. `web/src/routes/settings.tsx` does not import it. Change `display-prefs.tsx`.
`web/src/hooks/use-display-prefs.ts` (the hook and its storage) stays untouched — that is what keeps
`use-display-prefs.test.ts` green and off the diff.

**c.** The request says `web/src/routes/agent-chat.tsx`. The file is
`web/src/components/agent-chat.tsx` (the route is `web/src/routes/detail.tsx`, which renders it).

---

## The six changes

### 1 — `web/src/components/agent-chat.tsx`: hide `PaneStrip`, the swipe handle, the switcher sheet

`const desktop = useDesktop().on;` is already declared at line ~598, before the `return`. All three
sites are inside that `return`, so nothing moves.

**1a. `PaneStrip`** (~line 754): `{agent && (<PaneStrip … />)}` → `{!desktop && agent && (<PaneStrip … />)}`.

**1b. Swipe-up handle** (~lines 855–865): the block guarded by
`{agents.length + shellPanes.length > 0 && (<button … aria-label="Switch pane" {...swipe} className="… touch-none …">…)}`
→ `{!desktop && agents.length + shellPanes.length > 0 && ( … )}`. This is the only `touch-none`
element in the pane view, so hiding it satisfies "the `touch-none` strip" too.

**1c. Pane-switcher sheet** (~lines 929–946): wrap the whole
`<BottomSheet open={drawer === "switcher"} onClose={closeDrawer} title="Switch pane">…</BottomSheet>`
in `{!desktop && ( … )}`, so the markup is **absent**, not merely closed.

Leave `useSwipeUp` (line 148) where it is — hooks can't be conditional, and with the button gone
nothing binds it. `swipe` is still referenced inside the JSX you keep, so `noUnusedLocals` stays
happy. Leave `switchTo`, `ThreadSidebar`, the `Drawer` state and `openSpace` alone.

House-style comment at each site, one short sentence on *why*, e.g.:
`// Desktop: the sidebar IS the switcher, and there's no thumb to swipe with (spec §5).`

### 2 — `web/src/components/composer.tsx`: hide Keys, Type, attach

Add `import { useDesktop } from "@/lib/desktop";` and, inside `Composer` near the other top-level
reads, `const desktop = useDesktop().on;`.

- **2a. Keys button** (~797–810, the `<Button>` whose child text is `Keys`): wrap in `{!desktop && ( … )}`.
- **2b. Type button** (~820–845, `aria-label="Type into terminal"`): wrap in `{!desktop && ( … )}`.
- **2c. Attach-image button** (~987–1005, `aria-label="Attach image"`): wrap in `{!desktop && ( … )}`.

Nothing else in this file changes. Explicitly **do not touch**: `onKeyDown` on `ChatInput`, the
`direct.*` wiring, `onPasteImage`, `DirectTypingStrip`, `requestDrawer`, `pressKeys`, the destructive
two-tap guard. Those are phase 2/3.

Notes:
- `<input ref={fileRef} type="file" hidden …>` and `uploadImage` stay mounted — paste-to-upload uses
  them, and the spec keeps paste working on desktop (§5).
- `pr-11` on the textarea reserves room for the attach button. Leaving it when the button is hidden
  costs a strip of padding and keeps the diff to three wraps. Leave it.
- The Keys `<Button>` has no `aria-label`; its accessible name is the text `Keys`, so
  `getByRole("button", { name: "Keys" })` is the test handle.

### 3 — `web/src/components/display-prefs.tsx`: hide the `tapToFocus` row

Add `import { useDesktop } from "@/lib/desktop";`, then inside `DisplayPrefsContent`:

```tsx
const desktop = useDesktop().on;
```

Wrap the first `<Row label="Tap to type" … />` in `{!desktop && ( … )}`. Keep the `setTapToFocus`
prop and every other row exactly as they are.

Comment: `// Desktop: clicking the mirror is how direct typing arms (phase 2), so the pref has nothing left to mean.`

### 4 — `web/src/App.tsx`: 2 h idle on desktop

```tsx
import { useDesktop } from "@/lib/desktop";

// A desk session is left open for hours; a phone in a pocket is not. Passed explicitly (rather than
// leaning on the hook's default) so the value is one readable branch — and assertable in a test.
const DESKTOP_IDLE_MS = 2 * 60 * 60 * 1000;
const PHONE_IDLE_MS = 30 * 60 * 1000;

export function App() {
  const desktop = useDesktop().on;
  const { locked, unlock } = useIdleLock(desktop ? DESKTOP_IDLE_MS : PHONE_IDLE_MS);
  …
}
```

Leave `DEFAULT_IDLE_MS` in `web/src/hooks/use-idle-lock.ts` alone — that file is not edited.

### 5 — `web/src/routes/root.tsx`: the `(n) Collie` tab title

In `RootLayout`, after the existing `const desktop = useDesktop().on;`:

```tsx
// Desktop only: on a computer the tab strip IS the ambient notification surface, so the count of
// agents that need you rides in the title. A phone gets nothing — an installed PWA has no tab, and
// the spec's Decisions table rules out setAppBadge. Deliberately NO cleanup on unmount or on turning
// desktop mode off: spec §2 says the title is never touched when off, so the last count simply
// stands until the next reload.
const needsCount = data.agents.filter((a) => bucketOf(a) === "needs").length;
useEffect(() => {
  if (!desktop) return;
  document.title = needsCount > 0 ? `(${needsCount}) Collie` : "Collie";
}, [desktop, needsCount]);
```

Imports to add: `useEffect` from `react`, `bucketOf` from `@/lib/triage`.

Behaviour, stated so the tests can name it:
- off → the effect returns before writing; `document.title` is never assigned.
- on, 0 needs → `Collie`.
- on, 2 needs → `(2) Collie`.

`bucketOf(a) === "needs"` ⇔ `a.status === "blocked"` (see `lib/triage.ts`), so blocked fixture agents
are how a test makes the count.

### 6 — new `web/src/hooks/use-desktop-hotkeys.ts`, called once in `DesktopShell`

```ts
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";

import { panePath } from "@/lib/nav";
import { triage } from "@/lib/triage";
import type { AgentView } from "@/lib/types";

/**
 * The two desktop pane chords, and nothing else.
 *
 *   Ctrl+Alt+Down → next pane      Ctrl+Alt+Up → previous pane
 *
 * Order is `triage(agents)` flattened — "needs you" first, then ready, working, recent, tree order
 * within each section — so "next" means "next thing worth looking at", the same order the sidebar
 * and the command palette already show.
 *
 * ONE window listener, in CAPTURE phase, so it runs before the sheet's Escape listener and before
 * anything a pane surface binds. It calls preventDefault ONLY on the two chords it owns; every other
 * key — a bare ArrowDown, a plain Ctrl+F, Ctrl+Alt+Left — falls straight through untouched. That
 * restraint is the whole contract: Ctrl chords belong to the terminal (spec §6).
 *
 * Shells are not in the ring: `triage` takes agents only, and a shell has no status to triage.
 */
export function useDesktopHotkeys(
  agents: readonly AgentView[],
  currentPaneId: string | undefined,
  session?: string,
): void {
  const navigate = useNavigate();
  // The snapshot changes on every poll. Keep the args in a ref so the listener registers once rather
  // than tearing down and re-adding a few times a minute.
  const latest = useRef({ agents, currentPaneId, session });
  latest.current = { agents, currentPaneId, session };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey || !e.altKey || e.metaKey || e.shiftKey) return;
      const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (dir === 0) return;
      e.preventDefault();
      if (e.repeat) return; // holding the chord must not fly past every pane in the herd
      const { agents, currentPaneId, session } = latest.current;
      const ring = triage(agents).flatMap((s) => s.agents);
      if (ring.length === 0) return;
      const at = ring.findIndex((a) => a.paneId === currentPaneId);
      // Not on a pane (or on a shell, which isn't in the ring): Down opens the first, Up the last.
      const next =
        at === -1
          ? dir === 1
            ? ring[0]!
            : ring[ring.length - 1]!
          : ring[(at + dir + ring.length) % ring.length]!;
      if (next.paneId === currentPaneId) return;
      navigate(panePath(next.paneId, session));
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [navigate]);
}
```

Decisions baked in, so nothing has to be invented:
- **Wraps around.** Next from the last is the first — same as tab switching everywhere else.
- **Ignores autorepeat** but still `preventDefault`s it (it is our chord either way).
- **Requires exactly Ctrl+Alt** — no Shift, no Meta. AltGr on Windows reports `ctrlKey && altKey`,
  but Ctrl+Alt+Arrow is not a glyph on any layout, so there is no collision (spec §6).
- **Empty herd / single pane** → no navigation, no throw.

Wire it in `web/src/components/desktop-shell.tsx` — the only component that exists exactly when
desktop mode is on. `data` and `paneId` are already read there; add the import and one line:

```tsx
useDesktopHotkeys(data.agents, paneId, data.session);
```

Nothing else in `desktop-shell.tsx` changes.

---

## Tests

**Hard rule: do not edit any existing test file.** Every assertion below goes in a **new** file. The
acceptance gate is that the root suite still reports exactly `859 tests across 37 files` and the web
suite reports every existing test passing, with new tests only *added*.

Baselines measured on this branch just now:

| Suite | Command | Baseline |
|---|---|---|
| Bridge | `bun run test` (repo root) | `839 pass, 20 skip, 0 fail — Ran 859 tests across 37 files` |
| Web | `cd web && bun run test` | `Test Files 124 passed (124)` · `Tests 2690 passed \| 19 todo (2709)` |

Nothing in this plan touches `bridge/`, so the root numbers must come back byte-identical.

Harness facts (all already in the repo):
- `vi`, `describe`, `it`, `expect`, `beforeEach`, `beforeAll`, `afterEach` are globals — no imports.
- Reset the store around every desktop test:
  `beforeEach(() => __resetDesktop()); afterEach(() => __resetDesktop());`
  and turn it on with `setDesktop(true)` **before** `render`.
- Components using `useRevalidator` / `useNavigate` need a data router: `createMemoryRouter([...])`
  + `<RouterProvider router={…} />`. Copy the shape from `agent-chat.test.tsx` (`renderChat`) and
  `composer.test.tsx` (`renderComposer`).
- Fixtures from `@/test/handlers`: `fixtureAgents` = `w1:p1` claude **blocked** (workspace `w1`, tab
  `w1:t1`) and `w2:p1` codex **working**; `fixtureShellPanes` = `w2:p2` shell.
- `beforeAll(() => { if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}; })` —
  jsdom lacks it and the mirror calls it.

### New: `web/src/components/agent-chat-desktop.test.tsx`

Render `AgentChat` in a memory router with **two panes in the same tab** so `PaneStrip` draws
(it returns `null` under two panes):

```tsx
const a1 = fixtureAgents[0]!;                  // w1:p1, blocked, tab w1:t1
const a2 = { ...a1, paneId: "w1:p2" };         // same workspaceId + tabId
// props: paneId: a1.paneId, agent: a1, agents: [a1, a2], shellPanes: [], text: "…",
//        onBack: vi.fn(), onSelect: vi.fn()
```

- `on: false` (default): `getByRole("button", { name: "Switch pane" })` present; `getByText("Panes")`
  (the `PaneStrip` `SectionLabel`) present; `container.querySelector(".touch-none")` is not null.
- `on: false`, click "Switch pane" → the switcher sheet opens. Assert on whatever role/text
  `components/ui/sheet.tsx` renders for `BottomSheet title="Switch pane"` — read that file and pick
  the stable handle (a `dialog` role, or the title text) rather than guessing.
- `on: true`: all three `queryBy…` are `null`, and `container.querySelector(".touch-none")` is `null`.

### New: `web/src/components/composer-desktop.test.tsx`

Duplicate the small `renderComposer` props object from `composer.test.tsx` (it isn't exported — copy,
don't import).

- `on: false`: `getByRole("button", { name: "Keys" })`, `getByRole("button", { name: "Type into
  terminal" })`, `getByRole("button", { name: "Attach image" })` all present.
- `on: true`: all three `queryByRole(...)` are `null`.
- `on: true`: the reply textbox is still there (`getByRole("textbox")`) and Quick / ⚙ still render —
  proof we hid three controls, not the row.

### New: `web/src/components/display-prefs-desktop.test.tsx`

Render `DisplayPrefsContent` directly (plain component, no router) with
`prefs={{ fontSize: 11, rawTerminal: false, tapToFocus: true }}` and `vi.fn()` callbacks.

- `on: false`: `getByLabelText("Tap to type")` present.
- `on: true`: `queryByLabelText("Tap to type")` is `null`; "Raw terminal" and "Text size" still there.

### New: `web/src/App.test.tsx`

Mock the hook and the router module so nothing fetches:

```tsx
vi.mock("@/hooks/use-idle-lock", () => ({
  useIdleLock: vi.fn(() => ({ locked: false, unlock: vi.fn() })),
}));
vi.mock("./router", () => ({
  router: createMemoryRouter([{ path: "*", element: <div>app</div> }]),
}));
```

- `on: false` → `expect(useIdleLock).toHaveBeenCalledWith(30 * 60 * 1000)`.
- `on: true` → `expect(useIdleLock).toHaveBeenCalledWith(2 * 60 * 60 * 1000)`.

(If mocking `./router` is awkward, stubbing `RouterProvider` from `react-router` is an equally good
alternative — but mocking the module the app imports is simpler.)

### New: `web/src/routes/root-title.test.tsx`

Copy the mocks and the `renderRoot()` helper shape from `routes/root-desktop.test.tsx` (copy — do not
import from it, and do not edit it). Vary `data.agents`.

- `beforeEach`: `document.title = "Collie";`
- `on: false`, two **blocked** agents → after render, `expect(document.title).toBe("Collie")` — untouched.
- `on: true`, two blocked agents → `expect(document.title).toBe("(2) Collie")`.
- `on: true`, no blocked agents → `expect(document.title).toBe("Collie")`.
- `on: false` → **no capture listener is installed**: dispatch
  `new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, altKey: true, cancelable: true, bubbles: true })`
  on `window` and assert `defaultPrevented === false`. With desktop off, `DesktopShell` — and so the
  hook — never mounts. This is the "does not contain the hotkey listener" assertion.

### New: `web/src/hooks/use-desktop-hotkeys.test.tsx`

Harness inside a memory router that shows the current path:

```tsx
function Probe({ agents, paneId }: { agents: AgentView[]; paneId?: string }) {
  useDesktopHotkeys(agents, paneId);
  return <span data-testid="loc">{useLocation().pathname}</span>;
}
```

Dispatch with `fireEvent.keyDown(window, { key: "ArrowDown", ctrlKey: true, altKey: true })`, or
`window.dispatchEvent(new KeyboardEvent(…))` inside `act` when you need to read `defaultPrevented`.
`panePath` URL-encodes the colon, so the expected path for `w2:p1` is `/pane/w2%3Ap1`.

1. **Next in triage order.** `agents = fixtureAgents` (`w1:p1` blocked → "needs", `w2:p1` working →
   "working", so the ring is `[w1:p1, w2:p1]`), `paneId = "w1:p1"`. Ctrl+Alt+Down → `/pane/w2%3Ap1`.
2. **Previous wraps.** Same setup, Ctrl+Alt+Up from `w1:p1` → `/pane/w2%3Ap1` (wraps to the last).
3. **Next wraps.** From `w2:p1`, Ctrl+Alt+Down → `/pane/w1%3Ap1`.
4. **Triage order, not array order.** Three agents where the blocked one is **last** in the array.
   Build the expectation in the test from `triage(agents).flatMap(s => s.agents)` so the test states
   the rule, plus one `expect` naming the id outright for readability.
5. **A plain ArrowDown is not prevented.** `{ key: "ArrowDown" }`, no modifiers, `cancelable: true`
   → `expect(event.defaultPrevented).toBe(false)` and the path is unchanged.
6. **Other chords untouched.** Ctrl+F and Ctrl+Alt+Left → not prevented, no navigation.
7. **Empty herd** → no navigation, no throw.
8. **Listener removed on unmount** → unmount, dispatch Ctrl+Alt+Down, path unchanged.

---

## Version bump + CHANGELOG (mandatory — the pre-commit hook enforces it)

Three files to `0.56.1`:
- `herdr-plugin.toml` line 3 → `version = "0.56.1"`
- `package.json` line 3 → `"version": "0.56.1"`
- `web/package.json` line 3 → `"version": "0.56.1"`

`CHANGELOG.md` — insert directly under the intro paragraph, above `## [0.56.0]`:

```markdown
## [0.56.1] - 2026-08-22

### Added
- phone-only controls hidden, 2 h idle pause, `(n) Collie` tab title, Ctrl+Alt+Up/Down pane switch
```

Then `bash scripts/check-version.sh` — it must print `✓`.

---

## Verify — all five, in this order

```bash
bun run typecheck                      # repo root — clean
cd web && bun run typecheck && cd ..   # web (strict + verbatimModuleSyntax + erasableSyntaxOnly)
bun run test                           # must still read: Ran 859 tests across 37 files
cd web && bun run test                 # 124+N files, 2690+M passed, 0 failed, 19 todo
bash scripts/check-version.sh          # ✓
```

Then `git diff --name-only`. If any **existing** test file appears, revert it. If the root test count
moved at all, something under `bridge/` or `scripts/` was touched — revert it.

Note: `cd web && bun run test` runs `bun run typecheck && vitest run`, so the web typecheck happens
there too; running it separately first just fails faster.

Do **not** run `bun run build` unless you want the deployed bundle refreshed — the bridge serves
`web/dist` off disk, so a build on this box goes live immediately.

---

## Repo gotchas that bite here

- `web/` enforces `verbatimModuleSyntax`: `import type { AgentView } from "@/lib/types";` for
  type-only imports, or typecheck fails.
- `noUnusedLocals` / `noUnusedParameters` on both sides. After wrapping the swipe button in
  `!desktop &&`, `swipe` is still referenced inside the JSX you kept — check before deleting anything.
- No `dark:` variant anywhere inside the mirror `<pre>` (ADR 0002). Nothing here should need one.
- The pre-commit hook blocks a `web/src/` commit without a version bump. Do the bump in the same
  commit (or `SKIP_VERSION_CHECK=1` only if deliberately splitting out the release commit).
- The pre-push hook runs **both** suites. On Windows the lifecycle suite is
  `contrib/windows/collie-ctl.test.ps1`; that's expected, not a failure.
- Comment style: explain *why* at the line that would otherwise get changed back. Every `!desktop &&`
  gate deserves one short sentence.

---

## Out of scope — do not touch

- `web/src/hooks/use-display-prefs.ts` (the hook and its storage); anything under `bridge/`;
  `web/src/hooks/use-direct-typing.ts`; `web/src/hooks/use-long-press.ts`;
  `web/src/components/nav-tray.tsx`.
- In `composer.tsx`: everything except the three `!desktop &&` wraps and the `useDesktop` import.
  No keydown change, no send-behaviour change.
- Ctrl+` and Ctrl+F (phase 2). `setAppBadge`, a dynamic favicon (spec §8).
- Any change to what renders when desktop mode is **off**. That is the acceptance test (spec §9).

---

## Commit / PR

One commit on `feat/desktop-shell`:

```
Hide phone-only controls and add desktop hotkeys when desktop mode is on
```

Then `git push` (the pre-push hook runs both suites) and `gh pr create` against `main`. Tag `v0.56.1`
only once the release lands on `main`: `git tag -a v0.56.1 -m "Collie 0.56.1"`, pushed with
`--follow-tags`.
