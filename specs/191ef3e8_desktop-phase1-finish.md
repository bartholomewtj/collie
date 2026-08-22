# Plan — desktop mode phase 1, finish: hide the phone-only controls, 2 h idle, tab title, pane hotkeys

**Repo:** `C:\claudeOS\Projects\tools\collie` (Windows checkout, Git Bash)
**Branch:** `feat/desktop-shell` (already checked out — keep building on it)
**Version:** 0.56.0 → **0.56.1** (PATCH)
**Source of truth:** `specs/desktop-mode-spec.md` §2, §5, §6, §9 and its **Decisions** table. Do not
re-open anything in that table.

---

## 0. What is already on the branch (verified 2026-08-22)

Do not rebuild these — read them, then add to them.

- `web/src/lib/desktop.ts` — the store. `useDesktop() → { on, typing }`, `setDesktop`, `setTyping`,
  `desktopPrefs()`, `__resetDesktop()`, localStorage key `collie:desktop:v1`.
- `web/src/components/desktop-shell.tsx` — off-ramp strip + `DesktopSidebar` + `<Outlet/>` grid.
- `web/src/components/desktop-sidebar.tsx`, `web/src/components/desktop-control.tsx` (Settings card).
- `web/src/routes/root.tsx` already branches `desktop ? <DesktopShell/> : <Outlet/>` and already
  suppresses `BottomNav` when on.
- `web/src/components/agent-chat.tsx` already reads `const desktop = useDesktop().on;` (line ~598)
  and uses it only for the `max-w-[100dvw]` phone guard.
- Existing tests: `web/src/routes/root-desktop.test.tsx`, `web/src/components/desktop-shell.test.tsx`,
  `web/src/components/desktop-sidebar.test.tsx`. **Do not edit any of these.**

### Two path corrections in the request — read before you start

1. The request says `web/src/routes/agent-chat.tsx`. **That file does not exist.** The pane view is
   `web/src/components/agent-chat.tsx`, mounted by `web/src/routes/detail.tsx`.
2. The request says the Keys and Type controls live in `nav-tray.tsx`. **They do not.** `nav-tray.tsx`
   is the Keys *pad* that mounts inside the dock. The **Controls row** with the `Keys` and `Type`
   buttons is in `web/src/components/composer.tsx` (~lines 795–850), next to the attach button
   (~line 986). **`nav-tray.tsx` needs no change at all** — with the Keys control hidden the dock is
   unreachable. Do not add a `useDesktop` branch to it and do not write a test for it.

   The "hiding the attach button is the only change allowed in composer.tsx" line is aimed at
   *phase 2* work (Enter-sends, the keydown mapper). Read it as: **the only changes allowed in
   `composer.tsx` are conditional rendering** — hide the attach button, the `Keys` button and the
   `Type` button when `on`. **No change to `onKeyDown`, `send`, `onSendClick`, `onPasteImage`,
   `useDirectTyping` wiring, or any other behaviour.**

### Baselines to preserve (measured on this branch, 2026-08-22)

- `bun run test` (root): **859 tests across 37 files, 0 fail** — must be identical after your change.
- `cd web && bun run test`: **124 files, 2690 passed | 19 todo**. After your change: every one of
  those still passes, **no existing test file edited**, file count and test count go **up** only by
  the new files you add.
- `bun run typecheck` (root) and `cd web && bun run typecheck` both clean.

---

## 1. Hide the phone-only bits in the pane view

### 1a. `web/src/components/agent-chat.tsx`

`desktop` is already in scope. Three render sites, each gated with `!desktop`:

| ~Line | Thing | Change |
|---|---|---|
| ~753 | `{agent && (<PaneStrip … />)}` | `{agent && !desktop && (<PaneStrip … />)}` |
| ~854 | the swipe/tap handle `<button aria-label="Switch pane" … className="… touch-none …">` (this button **is** the "`touch-none` strip") | wrap the existing `agents.length + shellPanes.length > 0 &&` condition with `!desktop &&` |
| ~931 | `<BottomSheet open={drawer === "switcher"} …>` (the pane-switcher sheet) | `{!desktop && <BottomSheet …>…</BottomSheet>}` |

Leave `useSwipeUp`, `drawer`, `switchTo` and everything else alone — they are harmless when the only
thing that can set `drawer` to `"switcher"` is gone. Add a one-line comment at each site saying
desktop mode has the sidebar and the header instead.

### 1b. `web/src/components/composer.tsx` — rendering only

- Add `import { useDesktop } from "@/lib/desktop";` and `const desktop = useDesktop().on;` near the
  other hook calls.
- **Attach button** (~986, `aria-label="Attach image"`): wrap in `{!desktop && ( … )}`. Leave the
  hidden `<input ref={fileRef} type="file" …>` mounted (paste upload still uses `uploadImage`).
- **`Keys` button** in the Controls row (~803): wrap in `{!desktop && ( … )}`.
- **`Type` button** in the Controls row (~825, `aria-label="Type into terminal"`): wrap in
  `{!desktop && ( … )}`.
- Nothing else in this file changes. In particular: no `onKeyDown` edit, no send-path edit.

Add a short comment above the Controls row explaining why: on desktop the physical keyboard replaces
the Keys pad, and phase 2 replaces the Type toggle with Ctrl+` (spec §5).

### 1c. `web/src/components/display-prefs.tsx` — the `tapToFocus` row

The request calls it "the `tapToFocus` pref row in Settings". It is actually the **"Tap to type"**
row in `DisplayPrefsContent` (the composer ⚙ → Display dock), which is where every display pref
lives. Hide that row when `on`:

- `import { useDesktop } from "@/lib/desktop";`, `const desktop = useDesktop().on;`
- wrap the first `<Row label="Tap to type" … />` in `{!desktop && ( … )}`.
- Keep the `setTapToFocus` prop and its type — the phone branch still uses it, so `noUnusedParameters`
  stays happy.
- **`web/src/hooks/use-display-prefs.ts` is out of scope — do not touch it.**

---

## 2. `web/src/App.tsx` — idle pause is 2 h on desktop

```ts
import { useDesktop } from "@/lib/desktop";

// The idle pause is a battery/attention pause, not a lock (ADR 0007). A desk machine is left open
// and visible far longer than a phone, so a 30-minute cover there is noise, not care.
const PHONE_IDLE_MS = 30 * 60 * 1000;
const DESKTOP_IDLE_MS = 2 * 60 * 60 * 1000;

export function App() {
  const desktop = useDesktop().on;
  const { locked, unlock } = useIdleLock(desktop ? DESKTOP_IDLE_MS : PHONE_IDLE_MS);
  …
}
```

`useIdleLock(idleMs = DEFAULT_IDLE_MS)` already takes the argument (`web/src/hooks/use-idle-lock.ts`)
and re-arms on a change, so nothing else moves. `useDesktop` is a module store, so calling it outside
the router is fine.

---

## 3. `web/src/routes/root.tsx` — `(n) Collie` tab title

In `RootLayout`, after `const desktop = useDesktop().on;`:

```ts
// Desktop only: the tab strip is the only place a background window can say "someone needs you".
// Deliberately NOT restored when desktop mode is turned off — the request is explicit that the
// title is never touched while off, and a reload clears it.
const needsCount = data.agents.filter((a) => bucketOf(a) === "needs").length;
useEffect(() => {
  if (!desktop) return;
  document.title = needsCount > 0 ? `(${needsCount}) Collie` : "Collie";
}, [desktop, needsCount]);
```

Imports: `useEffect` from `react`, `bucketOf` from `@/lib/triage`. No `setAppBadge` (spec §8).

---

## 4. New hook — `web/src/hooks/use-desktop-hotkeys.ts`

Spec §6, phase-1 subset only: **Ctrl+Alt+Up = previous pane, Ctrl+Alt+Down = next pane.** Ctrl+` and
Ctrl+F are phase 2 — do not add them.

```ts
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";

import { triage } from "@/lib/triage";
import { panePath } from "@/lib/nav";
import type { AgentView } from "@/lib/types";

interface DesktopHotkeyArgs {
  agents: readonly AgentView[];
  currentPaneId?: string;
  session?: string;
}

/**
 * The phase-1 desktop hotkeys: Ctrl+Alt+Up / Ctrl+Alt+Down step through the herd in triage order
 * ("needs you" first, then ready, working, recent — lib/triage is the one ordering the app agrees
 * on, so the chord and the sidebar can never disagree).
 *
 * CAPTURE phase, so it runs before the sheet's own Escape listener (ui/sheet.tsx). It owns exactly
 * two chords and preventDefault()s NOTHING else — every other key, including a bare arrow, reaches
 * the page and the pane untouched.
 *
 * Ctrl+Alt is AltGr on a Windows/EU layout, but an arrow key is not a glyph, so there is no
 * collision with the AltGr rule the typing mapper will need in phase 2.
 */
export function useDesktopHotkeys({ agents, currentPaneId, session }: DesktopHotkeyArgs): void {
  const navigate = useNavigate();
  // Latest-value ref, so a poll that hands us a new `agents` array does not tear down and re-add a
  // window listener every few seconds.
  const latest = useRef({ agents, currentPaneId, session });
  latest.current = { agents, currentPaneId, session };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;
      const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (dir === 0) return;
      const { agents: list, currentPaneId: cur, session: sess } = latest.current;
      const order = triage(list).flatMap((s) => s.agents.map((a) => a.paneId));
      if (order.length === 0) return; // nothing to go to — leave the chord to the browser
      const at = cur ? order.indexOf(cur) : -1;
      const next =
        at === -1 ? (dir === 1 ? order[0]! : order[order.length - 1]!)
                  : order[(at + dir + order.length) % order.length]!;
      e.preventDefault();
      navigate(panePath(next, sess));
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [navigate]);
}
```

Notes for the builder:

- `triage()` takes `AgentView[]` and returns all four sections in fixed order; flattening gives
  exactly "needs you first, tree order within a section" because each section keeps the bridge's
  order for equal timestamps.
- Only **agents** are in the cycle, not shell panes — `triage` is an agent-only classifier and the
  request names `triage(agents)`.
- Wrap-around at both ends. From an unknown/absent pane, Down goes to the first and Up to the last.
- `e.preventDefault()` fires **only** on the two chords we handle, and only when we actually navigate.

### Call site — `web/src/components/desktop-shell.tsx`

`DesktopShell` already has `data` (from `useRouteLoaderData(ROOT_ROUTE_ID)`) and `paneId` (from
`useParams`). Add one line inside the component, above the `return`:

```ts
useDesktopHotkeys({ agents: data.agents, currentPaneId: paneId, session: data.session });
```

Called **once**, and only when desktop mode is on — `RootLayout` only mounts `DesktopShell` when `on`,
which is what makes "no hotkey listener when off" true by construction.

---

## 5. Tests — new files only

**Do not edit any existing test file.** Each new file resets the store in `beforeEach`/`afterEach`:

```ts
import { __resetDesktop, setDesktop } from "@/lib/desktop";
beforeEach(() => __resetDesktop());
afterEach(() => __resetDesktop());
```

### 5a. `web/src/components/agent-chat-desktop.test.tsx`

Copy the `renderChat` harness from `web/src/components/agent-chat.test.tsx` (lines 1–70): the
`Element.prototype.scrollTo` shim, `clearStatus()`, `localStorage.clear()`, `fixtureAgents`, and the
`createMemoryRouter` wrapper (`AgentChat` uses `useRevalidator`, so it needs a data router).

For the `PaneStrip` assertions you need a tab with two panes — `PaneStrip` returns `null` below two.
Build a local fixture:

```ts
const a1 = { ...fixtureAgents[0]! };
const a2 = { ...fixtureAgents[0]!, paneId: "w1:p2", status: "working" as const };
// render with agents: [a1, a2] — same workspaceId "w1" and tabId "w1:t1"
```

Two `describe`s:

**`on: false` (default) — the phone surface is untouched:**
- `screen.getByRole("button", { name: "Switch pane" })` exists (the swipe/`touch-none` handle).
- `screen.getByText("Panes")` exists (`PaneStrip`'s `SectionLabel`).
- `screen.getByRole("button", { name: /^Keys$/ })` exists.
- `screen.getByRole("button", { name: "Type into terminal" })` exists.
- `screen.getByRole("button", { name: "Attach image" })` exists.
- clicking the handle opens the switcher sheet (`await screen.findByText("Switch pane")` as the
  sheet title, or assert on the `ThreadSidebar` rows).

**`on: true` (`setDesktop(true)` before render) — all five are gone:**
- `queryByRole("button", { name: "Switch pane" })` → null
- `queryByText("Panes")` → null
- `queryByRole("button", { name: /^Keys$/ })` → null
- `queryByRole("button", { name: "Type into terminal" })` → null
- `queryByRole("button", { name: "Attach image" })` → null
- and the composer textarea and Send button are **still** present (proof we hid controls, not the
  composer).

### 5b. `web/src/components/display-prefs-desktop.test.tsx`

Render `<DisplayPrefsContent prefs={{ fontSize: 11, rawTerminal: false, tapToFocus: true }}
stepFontSize={vi.fn()} setRawTerminal={vi.fn()} setTapToFocus={vi.fn()} />` directly.

- `on: false` → `getByRole("switch", { name: "Tap to type" })` exists and `getByText("Raw terminal")`
  exists.
- `on: true` → `queryByRole("switch", { name: "Tap to type" })` is null, `getByText("Raw terminal")`
  still exists.

### 5c. `web/src/App.test.tsx`

Mock the seams so nothing hits the network:

```ts
vi.mock("@/hooks/use-idle-lock", () => ({ useIdleLock: vi.fn(() => ({ locked: false, unlock: vi.fn() })) }));
vi.mock("@/components/busy-bar", () => ({ BusyBar: () => null }));
vi.mock("./router", async () => {
  const { createMemoryRouter } = await import("react-router");
  return { router: createMemoryRouter([{ path: "*", element: <div>app stand-in</div> }]) };
});
```

- `on: false` → `render(<App />)`, `expect(useIdleLock).toHaveBeenCalledWith(30 * 60 * 1000)`.
- `on: true` → `setDesktop(true)` before render, `expect(useIdleLock).toHaveBeenCalledWith(2 * 60 * 60 * 1000)`.
- Clear the mock between the two (`vi.mocked(useIdleLock).mockClear()`).

### 5d. `web/src/routes/root-title.test.tsx`

Model on `web/src/routes/root-desktop.test.tsx` (same `vi.mock` list for `use-polling`,
`use-transitions`, `use-push`, `use-poll-busy`, the two banners; same `HomeData` literal), but with
two **blocked** agents so `bucketOf` puts both in `needs`:

```ts
const needsAgents = [
  { ...fixtureAgents[0]!, paneId: "w1:p1", status: "blocked" as const },
  { ...fixtureAgents[0]!, paneId: "w1:p2", status: "blocked" as const },
];
```

Set `document.title = "Collie"` in `beforeEach` and restore it in `afterEach`.

- `on: false` → render with `needsAgents`; `expect(document.title).toBe("Collie")` (untouched — set a
  sentinel like `document.title = "sentinel"` before render and assert it is still `"sentinel"`, which
  is the honest "never touches the title" assertion).
- `on: true` → `await waitFor(() => expect(document.title).toBe("(2) Collie"))`.
- `on: true` with zero blocked agents → `document.title === "Collie"`.
- `on: true` renders `DesktopShell`, which mounts the hotkey listener; keep the router children
  trivial (`{ index: true, element: <div>outlet</div> }`) as `root-desktop.test.tsx` does.

### 5e. `web/src/hooks/use-desktop-hotkeys.test.tsx`

Drive the hook through a tiny host component inside a `createMemoryRouter`, with a location probe so
you can read where it navigated:

```tsx
function Host({ agents, paneId }: { agents: AgentView[]; paneId?: string }) {
  useDesktopHotkeys({ agents, currentPaneId: paneId });
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}
```

Fixture: three agents ordered so triage is non-trivial — e.g. `working` (`w1:p1`), `blocked`
(`w2:p1`), `working` (`w3:p1`). `triage` puts the blocked one first, so flattened order is
`["w2:p1", "w1:p1", "w3:p1"]`.

Cases:
1. **Ctrl+Alt+Down from the first pane goes to the next in triage order.** Start at
   `currentPaneId: "w2:p1"`; dispatch
   `new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, altKey: true, bubbles: true, cancelable: true })`
   on `window`; assert `where` becomes `/pane/w1%3Ap1` (use `panePath("w1:p1")` to build the
   expectation rather than hand-encoding).
2. **Ctrl+Alt+Up** from `"w1:p1"` goes back to `"w2:p1"`.
3. **Wrap:** Down from the last (`"w3:p1"`) lands on `"w2:p1"`.
4. **A plain ArrowDown is not prevented:** dispatch a `cancelable` `keydown` with no modifiers and
   assert `ev.defaultPrevented === false` and the pathname did not change.
5. **Ctrl+Alt+Left is not prevented** (proves we only own two chords).
6. **Ctrl+Shift+Alt+Down is not prevented** (the modifier check is strict).
7. **No agents → nothing prevented, no navigation.**
8. **Unmount removes the listener:** unmount, dispatch Ctrl+Alt+Down, assert `defaultPrevented` is
   `false`.

Wrap each dispatch in `act(() => { window.dispatchEvent(ev); })` so React flushes the navigation.

---

## 6. Version bump + CHANGELOG (mandatory — pre-commit hook enforces it)

Set `0.56.1` in all three:

- `herdr-plugin.toml` → `version = "0.56.1"`
- `package.json` → `"version": "0.56.1"`
- `web/package.json` → `"version": "0.56.1"`

`CHANGELOG.md`, directly under the intro block and above `## [0.56.0]`:

```markdown
## [0.56.1] - 2026-08-22

### Added
- phone-only controls hidden, 2 h idle pause, `(n) Collie` tab title, Ctrl+Alt+Up/Down pane switch
```

Use today's real date if it is not 2026-08-22 when you run.

Then `bash scripts/check-version.sh` must print `✓`.

---

## 7. Verify — run all of these, judge by exit status

```bash
bun run typecheck                 # root tsconfig (bridge/scripts)
cd web && bun run typecheck       # web tsconfig — verbatimModuleSyntax + erasableSyntaxOnly
cd web && bun run test            # must be 124 + your new files, 2690 + your new tests, 0 fail
bun run test                      # root — must still be exactly 859 tests across 37 files
bash scripts/check-version.sh     # ✓
bun run build                     # typechecks both sides, then builds web/dist atomically
```

Then confirm by reading the output, not by trusting it: `cd web && bun run test` must report **more**
files and **more** tests than the baseline (124 / 2690 + 19 todo) and **zero** failures, and
`git status --short` must show **no existing `*.test.ts(x)` file modified**.

`bun run build` is worth running because the bridge serves `web/dist` from disk and a stale bundle is
this repo's #1 "my change didn't take" trap.

---

## 8. Commit and PR

Branch `feat/desktop-shell` is already the working branch — commit onto it.

- One functional commit (the code + the new tests), then the release commit that bumps the three
  version files and adds the CHANGELOG line, so the CHANGELOG entry can cite the functional commit's
  short hash per `CLAUDE.md` → Versioning.
- Do **not** push a `v0.56.1` tag yourself; the operator cuts and merges. If asked to open the PR:
  `git push -u origin feat/desktop-shell` then `gh pr create`.
- The pre-push hook runs both suites. Do not use `SKIP_TESTS=1`.

---

## 9. Out of scope — do not touch

- `web/src/hooks/use-display-prefs.ts` (the hook; the *component* `display-prefs.tsx` is in scope).
- `bridge/` — nothing at all.
- `web/src/hooks/use-direct-typing.ts`, `web/src/hooks/use-long-press.ts` (phases 2–3).
- Ctrl+` and Ctrl+F (phase 2). `setAppBadge`, dynamic favicon (spec §8).
- `web/src/components/nav-tray.tsx` — no change needed (see §0).
- Any change to what renders when `on` is false. Every new assertion in the `on: false` branch must
  pass against the code as it is today.
