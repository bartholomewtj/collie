# Plan — desktop mode phase 1, finish

**Repo:** `C:\claudeOS\Projects\tools\collie` (Windows checkout, Git Bash)
**Branch:** `feat/desktop-shell` (already checked out, tree clean at `347ef58`)
**Version:** 0.56.0 → **0.56.1** (PATCH, as instructed)
**Source spec:** `specs/desktop-mode-spec.md` §2, §5, §6, §9. The "Decisions" table in that spec is
settled — do not re-open any row of it.

## What already exists on this branch (verified — don't rebuild it)

- `web/src/lib/desktop.ts` — the store. `useDesktop()` → `{ on, typing }`, `setDesktop`,
  `setTyping`, `desktopPrefs()`, `__resetDesktop()`. localStorage key `collie:desktop:v1`.
- `web/src/components/desktop-shell.tsx` — off-ramp strip + 280 px sidebar + `<Outlet/>`.
- `web/src/components/desktop-sidebar.tsx` — tree, session switcher, `nav aria-label="Desktop navigation"`.
- `web/src/components/desktop-control.tsx` — the Settings card (Desktop mode switch, Typing surface,
  Idle pause note).
- `web/src/routes/root.tsx` — already swaps `<DesktopShell/>` for `<Outlet/>` and drops `BottomNav`
  when on.
- `web/src/routes/settings.tsx` — already hides `HapticsControl` when on.
- `web/src/routes/tree.tsx`, `web/src/routes/files.tsx`, `web/src/components/agent-chat.tsx` — already
  drop `max-w-screen-sm` / the `max-w-[100dvw]` phone guard when on.
- Tests already present: `web/src/routes/root-desktop.test.tsx`,
  `web/src/components/desktop-shell.test.tsx`, `web/src/components/desktop-sidebar.test.tsx`,
  `web/src/lib/desktop.test.ts`.

## What is left — six changes

1. Pane view: hide the swipe handle, the switcher sheet and `PaneStrip` when on.
2. Composer Controls row: hide Keys, Type and the attach-image button when on.
3. Display prefs dock: hide the `tapToFocus` row when on.
4. `App.tsx`: pass `2 h` to `useIdleLock` when on, `30 min` when off.
5. `RootLayout`: set `document.title` to `(n) Collie` / `Collie` when on; never touch it when off.
6. New `useDesktopHotkeys()` hook, called once in `DesktopShell`: Ctrl+Alt+Up / Ctrl+Alt+Down = prev /
   next pane.

Plus: new tests beside every touched file, version bump, CHANGELOG line.

---

## Two corrections to the request wording — read before you start

**a. The Keys / Type / attach controls are in `composer.tsx`, not `nav-tray.tsx`.**
The request says "the Keys and Type controls in the Controls row (`nav-tray.tsx`)". That is wrong
about the file. `web/src/components/nav-tray.tsx` is the *keys pad itself* (the thing the Keys dock
mounts); the **Controls row** — the `Keys · Type · Quick · ⚙` button row — is in
`web/src/components/composer.tsx` around lines 793–845, and the attach-image button is in the same
file around line 990.

So: **do not edit `nav-tray.tsx`** (it needs no change — with the Keys button hidden the dock can
never open), and **do edit `composer.tsx`**. The request's "out of scope" line names `composer.tsx`
"(phases 2–3)"; that means the *phase 2–3 typing work* (Enter-sends, the keydown mapper, Ctrl+`,
paste hold, focus-driven arming) stays out. The three-line hide required by the "Done means" list is
in scope, because there is no other place to do it.

**b. The `tapToFocus` pref row is not in the Settings route.**
It lives in `web/src/components/display-prefs.tsx` (`DisplayPrefsContent`), which the composer's ⚙
dock mounts. That is the file to change. `web/src/hooks/use-display-prefs.ts` (the hook and its
storage) stays untouched — that is what keeps `use-display-prefs.test.ts` green.

---

## Change 1 — `web/src/components/agent-chat.tsx`

`const desktop = useDesktop().on;` already exists at line ~598, but it is declared *after* the
handlers and just before the `return`. Everything below is inside that same `return`, so no move is
needed.

**1a. `PaneStrip`** (~line 754). Currently `{agent && (<PaneStrip … />)}`. Change the condition to
`{!desktop && agent && (<PaneStrip … />)}`.

**1b. The swipe-up handle** (~line 850–866). Currently
`{agents.length + shellPanes.length > 0 && (<button … aria-label="Switch pane" {...swipe} className="… touch-none …">…</button>)}`.
Change to `{!desktop && agents.length + shellPanes.length > 0 && ( … )}`. This is also the only
`touch-none` element in the pane view, so hiding it satisfies "the `touch-none` strip" too.

**1c. The pane-switcher sheet** (~line 931–946). Wrap the whole
`<BottomSheet open={drawer === "switcher"} …>…</BottomSheet>` in `{!desktop && ( … )}` so the sheet
markup is absent, not merely closed.

Leave the `useSwipeUp` call itself in place (hooks can't be conditional) — with the button gone
nothing binds it. Leave `switchTo`, `ThreadSidebar` imports and the `Drawer` state alone; the sidebar
is still reachable from `openSpace` and the desktop sidebar.

Add a short comment at each of the three sites in the house style, e.g.:
`// Desktop: the sidebar IS the switcher, and there is no thumb to swipe with — see specs/desktop-mode-spec.md §5.`

## Change 2 — `web/src/components/composer.tsx`

Add `import { useDesktop } from "@/lib/desktop";` and, inside `Composer`, near the other top-level
reads, `const desktop = useDesktop().on;`.

**2a. Keys button** (~line 800–810): wrap in `{!desktop && ( … )}`.
**2b. Type button** (~line 823–845): wrap in `{!desktop && ( … )}`.
**2c. Attach-image button** (~line 986–1006): wrap in `{!desktop && ( … )}`.

Nothing else in this file changes. In particular do **not** touch: `onKeyDown` on `ChatInput`, the
`direct.*` wiring, `onPasteImage`, `DirectTypingStrip`, `requestDrawer`, `pressKeys`, the destructive
two-tap guard. Those are phase 2/3.

Notes for the builder:
- The `<input ref={fileRef} type="file" hidden …>` and `uploadImage` stay mounted — paste-to-upload
  still uses them, and the spec keeps paste working on desktop (§5).
- `pr-11` on the textarea reserves room for the attach button. Leaving it when the button is hidden
  is harmless (a strip of padding) and keeps the diff to three wraps; leave it.

## Change 3 — `web/src/components/display-prefs.tsx`

Add `import { useDesktop } from "@/lib/desktop";` and inside `DisplayPrefsContent`:

```tsx
const desktop = useDesktop().on;
```

Wrap the first `<Row label="Tap to type" … />` in `{!desktop && ( … )}`. Keep the `setTapToFocus`
prop and the rest of the component exactly as they are — `use-display-prefs.ts` is out of scope and
its tests must not move.

Comment: `// Desktop: clicking the mirror is how direct typing arms (phase 2), so the pref has nothing left to mean.`

## Change 4 — `web/src/App.tsx`

```tsx
import { useDesktop } from "@/lib/desktop";

const DESKTOP_IDLE_MS = 2 * 60 * 60 * 1000; // 2 h — a desk session, not a phone in a pocket
const PHONE_IDLE_MS = 30 * 60 * 1000;

export function App() {
  const desktop = useDesktop().on;
  const { locked, unlock } = useIdleLock(desktop ? DESKTOP_IDLE_MS : PHONE_IDLE_MS);
  …
}
```

`useIdleLock`'s default parameter (`30 * 60 * 1000`) stays in the hook — don't delete it, other
callers/tests read it. Passing the same number explicitly is what makes the arg assertable in a test.
Do not change `web/src/hooks/use-idle-lock.ts`.

## Change 5 — `web/src/routes/root.tsx` (tab title)

In `RootLayout`, after `const desktop = useDesktop().on;`:

```tsx
// Desktop only: the tab strip is the notification surface on a computer, so the count of agents
// that need you rides in the title. Phones get nothing — a PWA has no tab, and the spec's
// Decisions table rules out setAppBadge. Deliberately no cleanup: when desktop mode is turned OFF
// we must not touch the title at all (spec §2), so the last count stays until the next reload.
const needsCount = data.agents.filter((a) => bucketOf(a) === "needs").length;
useEffect(() => {
  if (!desktop) return;
  document.title = needsCount > 0 ? `(${needsCount}) Collie` : "Collie";
}, [desktop, needsCount]);
```

Imports to add: `useEffect` from `react`, `bucketOf` from `@/lib/triage`.

Behaviour to be explicit about (and to state in the test names):
- `on: false` → the effect returns before writing. `document.title` is whatever `index.html` set
  (`Collie`) or whatever a test set. Never written.
- `on: true`, 0 needs → `Collie`.
- `on: true`, 2 needs → `(2) Collie`.

## Change 6 — `web/src/hooks/use-desktop-hotkeys.ts` (new)

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
 * and the palette already show.
 *
 * ONE window listener, in CAPTURE phase, so it runs before the sheet's Escape listener and before
 * anything a pane surface binds. It calls preventDefault ONLY on the two chords it owns; every other
 * key, including a bare ArrowDown or a plain Ctrl+F, falls straight through untouched. That
 * restraint is the whole contract — Ctrl chords belong to the terminal (spec §6).
 *
 * Shells are not in the ring: `triage` takes agents only, and a shell has no status to triage.
 */
export function useDesktopHotkeys(
  agents: readonly AgentView[],
  currentPaneId: string | undefined,
  session?: string,
): void {
  const navigate = useNavigate();
  // The snapshot changes on every poll. Keep the args in a ref so the listener is registered once
  // rather than torn down and re-added a few times a minute.
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

Decisions baked in above, so the builder doesn't have to invent them:
- **Wraps around.** Next from the last pane is the first. Same as tab switching everywhere else.
- **Ignores autorepeat** but still `preventDefault`s it (it is our chord either way).
- **Requires exactly Ctrl+Alt**, no Shift, no Meta. AltGr on Windows reports `ctrlKey && altKey`, but
  Ctrl+Alt+Arrow is not a glyph on any layout, so there is no collision (spec §6).
- **Empty herd / single pane** → no navigation, no crash.

### Wire it into `web/src/components/desktop-shell.tsx`

Call it once, from the shell, which is the only component that exists exactly when desktop mode is on:

```tsx
useDesktopHotkeys(data.agents, paneId, data.session);
```

`data` and `paneId` are already read there. Add the import. Nothing else in `desktop-shell.tsx`
changes.

---

## Tests

**Hard rule: do not edit any existing test file.** Every assertion below goes in a new file. Reason:
the acceptance gate is that the root suite still reports exactly `859 tests across 37 files` and the
web suite reports every existing test passing, with new tests only *added* to the web count.

Baselines measured on this branch just now:

| Suite | Command | Baseline |
|---|---|---|
| Bridge | `bun run test` (repo root) | `839 pass, 20 skip, 0 fail — 859 tests across 37 files` |
| Web | `cd web && bun run test` | `124 files, 2690 passed \| 19 todo (2709)` |

Nothing in this plan touches `bridge/`, so the root number must come back byte-identical.

Test-harness facts you'll need (all already in the repo):
- `vi`, `describe`, `it`, `expect`, `beforeEach` are globals — no import.
- Reset the store around every desktop test: `beforeEach(() => __resetDesktop()); afterEach(() => __resetDesktop());`
  and turn it on with `setDesktop(true)` *before* `render`.
- Components using `useRevalidator` / `useNavigate` need a data router:
  `createMemoryRouter([...])` + `<RouterProvider router={…} />`. Copy the shape from
  `agent-chat.test.tsx` / `composer.test.tsx`.
- Fixtures: `fixtureAgents` (`w1:p1` claude **blocked**, `w2:p1` codex **working**),
  `fixtureShellPanes` (`w2:p2`), from `@/test/handlers`.
- `beforeAll(() => { if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}; })` —
  jsdom lacks it and the mirror calls it.

### New file: `web/src/components/agent-chat-desktop.test.tsx`

Render `AgentChat` inside a memory router, with a two-pane tab so `PaneStrip` has something to draw
(it returns `null` under two panes):

```tsx
const a1 = fixtureAgents[0]!;
const a2 = { ...a1, paneId: "w1:p2" }; // same workspaceId + tabId, so the strip renders
```

- `on: false` (default): `getByRole("button", { name: "Switch pane" })` exists;
  `getByText("Panes")` (the `PaneStrip` section label) exists;
  `container.querySelector(".touch-none")` is not null.
- `on: false`, click the "Switch pane" button → the sheet opens (`getByText("Switch pane")` heading
  / `findByRole("dialog")` per `BottomSheet`'s markup — check `components/ui/sheet.tsx` for the role
  it renders and assert on that).
- `on: true`: all three `queryBy…` are `null`, and `container.querySelector(".touch-none")` is
  `null`.

### New file: `web/src/components/composer-desktop.test.tsx`

Copy `renderComposer` from `composer.test.tsx` (don't import it — it isn't exported; duplicate the
small props object).

- `on: false`: `getByRole("button", { name: "Keys" })`, `getByRole("button", { name: "Type into
  terminal" })`, `getByRole("button", { name: "Attach image" })` all present.
- `on: true`: all three `queryByRole(...)` are `null`.
- `on: true`: the reply textarea is still there (`getByRole("textbox")`) and Quick / ⚙ still render —
  proof we hid three controls, not the row.

### New file: `web/src/components/display-prefs-desktop.test.tsx`

Render `DisplayPrefsContent` directly (plain component, no router needed) with
`prefs={{ fontSize: 11, rawTerminal: false, tapToFocus: true }}` and `vi.fn()` callbacks.

- `on: false`: `getByLabelText("Tap to type")` present.
- `on: true`: `queryByLabelText("Tap to type")` is `null`; "Raw terminal" and "Text size" still there.

### New file: `web/src/App.test.tsx`

Mock both the hook and the router module so nothing fetches:

```tsx
vi.mock("@/hooks/use-idle-lock", () => ({ useIdleLock: vi.fn(() => ({ locked: false, unlock: vi.fn() })) }));
vi.mock("./router", () => ({ router: createMemoryRouter([{ path: "*", element: <div>app</div> }]) }));
```

- `on: false` → `expect(useIdleLock).toHaveBeenCalledWith(30 * 60 * 1000)`.
- `on: true` → `expect(useIdleLock).toHaveBeenCalledWith(2 * 60 * 60 * 1000)`.

(If mocking `./router` proves awkward, an equally good alternative is to mock
`react-router`'s `RouterProvider` to a stub — but mocking the module the app imports is simpler.)

### New file: `web/src/routes/root-title.test.tsx`

Same mocks and `renderRoot()` helper shape as the existing `root-desktop.test.tsx` (copy them; do
not import from it). Use `data.agents` variants:

- `beforeEach`: `document.title = "Collie";`
- `on: false`, two blocked agents → after render, `expect(document.title).toBe("Collie")` (untouched).
- `on: true`, two blocked agents (`bucketOf === "needs"`) → `expect(document.title).toBe("(2) Collie")`.
- `on: true`, no blocked agents → `expect(document.title).toBe("Collie")`.
- `on: false` → no `keydown` capture listener is installed: dispatch
  `new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, altKey: true, cancelable: true, bubbles: true })`
  on `window` and assert `defaultPrevented === false`. (With desktop off, `DesktopShell` — and so the
  hook — never mounts. This is the "does not contain the hotkey listener" assertion.)

Use `status: "blocked"` agents to make the "needs" bucket: `bucketOf` returns `"needs"` for
`status === "blocked"`.

### New file: `web/src/hooks/use-desktop-hotkeys.test.tsx`

Harness component inside a memory router that shows the current path:

```tsx
function Probe({ agents, paneId }: { agents: AgentView[]; paneId?: string }) {
  useDesktopHotkeys(agents, paneId);
  return <span data-testid="loc">{useLocation().pathname}</span>;
}
```

Dispatch with `fireEvent.keyDown(window, { key: "ArrowDown", ctrlKey: true, altKey: true })` wrapped
in `act`, or `window.dispatchEvent(new KeyboardEvent(...))` inside `act` when you need to read
`defaultPrevented`.

Cases:
1. **Next in triage order.** `agents = fixtureAgents` (`w1:p1` blocked → "needs", `w2:p1` working →
   "working", so the ring is `[w1:p1, w2:p1]`), `paneId = "w1:p1"`. Ctrl+Alt+Down → path becomes
   `/pane/w2%3Ap1`.
2. **Previous wraps.** Same setup, Ctrl+Alt+Up from `w1:p1` → `/pane/w2%3Ap1` (wraps to the last).
3. **Next wraps.** From `w2:p1`, Ctrl+Alt+Down → `/pane/w1%3Ap1`.
4. **Triage order, not tree order.** Give three agents where the blocked one is *last* in the array
   and assert Down from the first array element goes to the blocked one only if that is what the
   flattened `triage` order says — i.e. build the expectation from
   `triage(agents).flatMap(s => s.agents)` in the test itself so the test states the rule rather than
   a hard-coded id. (One `expect` naming the id as well, for readability.)
5. **A plain ArrowDown is not prevented.** Dispatch `{ key: "ArrowDown" }` with no modifiers,
   `cancelable: true` → `expect(event.defaultPrevented).toBe(false)`, and the path is unchanged.
6. **Other chords untouched.** Ctrl+F and Ctrl+Alt+Left → not prevented, no navigation.
7. **Empty herd** → no navigation, no throw.
8. **Listener is removed on unmount** → unmount, dispatch Ctrl+Alt+Down, path unchanged.

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

## Verify (all four must pass, in this order)

```bash
bun run typecheck                    # repo root — must be clean
cd web && bun run typecheck && cd .. # web side (strict + verbatimModuleSyntax + erasableSyntaxOnly)
bun run test                         # must still read: 859 tests across 37 files
cd web && bun run test               # 124 + N files, 2690 + M passed, 0 failed, 19 todo
bash scripts/check-version.sh        # ✓
```

If the root count moves at all, something under `bridge/` or `scripts/` was touched — revert it.
If any *existing* web test file shows in `git diff --name-only`, revert that file.

Do not run `bun run build` unless you want the deployed bundle refreshed; the bridge serves
`web/dist` off disk, so a build here would go live immediately on this box.

## Gotchas specific to this repo

- `web/` enforces `verbatimModuleSyntax` — use `import type { AgentView } from "@/lib/types";` for
  type-only imports, or typecheck fails.
- `noUnusedLocals` / `noUnusedParameters` are on both sides. If wrapping the swipe button in
  `!desktop` leaves `swipe` "unused", it is still referenced inside the JSX you kept — check before
  deleting anything.
- Do **not** add a `dark:` variant anywhere inside the mirror `<pre>` (ADR 0002). Nothing here should
  need one.
- The pre-commit hook blocks a `web/src/` commit without a version bump. Do the bump in the same
  commit, or use `SKIP_VERSION_CHECK=1` only if you are deliberately splitting the release commit out.
- Follow the repo comment style: explain *why* at the line that would otherwise get changed back.
  Every `!desktop &&` gate above deserves one short sentence.

## Out of scope — do not touch

- `web/src/hooks/use-display-prefs.ts` (the hook + its storage), `bridge/` (anything),
  `web/src/hooks/use-direct-typing.ts`, `web/src/hooks/use-long-press.ts`,
  `web/src/components/nav-tray.tsx`.
- In `composer.tsx`: everything except the three `!desktop &&` wraps and the `useDesktop` import.
- Ctrl+` and Ctrl+F (phase 2). `setAppBadge`, a dynamic favicon (spec §8).
- Any change to what renders when desktop mode is **off**. That is the acceptance test (spec §9).

## Suggested commit / PR

One commit on `feat/desktop-shell`:

```
Hide phone-only controls and add desktop hotkeys when desktop mode is on
```

Then `git push` (the pre-push hook runs both suites) and `gh pr create` against `main`. Tag
`v0.56.1` only when the release lands on `main` — `git tag -a v0.56.1 -m "Collie 0.56.1"` and push
it with `--follow-tags`.
