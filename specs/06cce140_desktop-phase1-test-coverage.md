# Plan — close the three blocking review findings on 730efcf (test coverage only)

## 1. What this is

Commit `730efcf` shipped desktop mode phase 1: phone-only controls hidden, 2 h idle pause,
`(n) Collie` tab title, Ctrl+Alt+Up/Down pane hotkeys. The reviewer
(`adws/adw_data/sessions/191ef3e8/context_handoff/review.md`) **approved all production code** and
blocked on three test files that exist but do not assert what the spec asked for.

**This job changes test files only, plus the version bump.** No production file under `web/src/` may
change. No existing test file may be edited.

The three files already pass today (baseline: 3 files, 6 tests, ~1.7 s). You are expanding them.

## 2. Files you touch

| File | Change |
|---|---|
| `web/src/components/agent-chat-desktop.test.tsx` | Rewrite: same-tab two-pane fixture, five hidden controls, sheet opens |
| `web/src/hooks/use-desktop-hotkeys.test.tsx` | Rewrite: `createMemoryRouter` + pathname probe, 8 cases |
| `web/src/routes/root-title.test.tsx` | Add zero-needs case; stop mutating a shared `data` |
| `herdr-plugin.toml` · `package.json` · `web/package.json` | version `0.56.1` → `0.56.2` |
| `CHANGELOG.md` | new `## [0.56.2] - 2026-08-22` heading with one `### Changed` line |

Nothing else. Do not touch `web/src/hooks/use-display-prefs.ts`, `bridge/`,
`web/src/hooks/use-direct-typing.ts`, `web/src/hooks/use-long-press.ts`, `nav-tray.tsx`, or any
non-test file under `web/src/`.

## 3. Facts you need (verified in the tree — don't re-derive them)

**Desktop store** — `web/src/lib/desktop.ts`: `setDesktop(on)`, `useDesktop()`, and
`__resetDesktop()` (clears module state + `localStorage["collie:desktop:v1"]` + notifies listeners).
Reset in `beforeEach` **and** `afterEach` — the store is module-scoped and survives `cleanup()`.

**Vitest globals are on** (`web/vite.config.ts` → `test.globals: true`), so `describe`/`it`/`expect`/
`beforeEach`/`vi` need no import. `web/src/test/setup.ts` already does `localStorage.clear()`,
`cleanup()`, MSW reset per test.

**Accessible names in the pane view** (exact strings — these are what the queries must use):

| Control | Query | Source |
|---|---|---|
| Swipe handle | `getByRole("button", { name: "Switch pane" })` | `agent-chat.tsx:~851` `aria-label="Switch pane"`, gated `{!desktop && agents.length + shellPanes.length > 0 &&` |
| Pane strip | `getByText("Panes")` | `pane-strip.tsx:51` `<SectionLabel>Panes</SectionLabel>` |
| Keys | `getByRole("button", { name: "Keys" })` | `composer.tsx:~804`, gated `{!desktop &&` |
| Type toggle | `getByRole("button", { name: "Type into terminal" })` | `composer.tsx:832` `aria-label` |
| Attach | `getByRole("button", { name: "Attach image" })` | `composer.tsx:1002` `aria-label`, gated `{!desktop &&` |
| Send | `getByRole("button", { name: "Send" })` | `composer.tsx:1040` (`aria-label` flips to "Stop typing into terminal" only when direct typing is armed) |
| Composer textarea | `getByPlaceholderText("Type a reply…")` | `composer.tsx:~966`; a `claude` agent that is not gone/read-only gets that placeholder. Note the character is a real ellipsis `…`, not three dots. |
| Switcher sheet | `getByRole("dialog", { name: "Switch pane" })` | `ui/sheet.tsx:~110` — `role="dialog"` + `aria-labelledby` the title span; `if (!open) return null`, so the dialog does not exist before the click |

**`PaneStrip` returns `null` below two panes** (`pane-strip.tsx:46`), and `agent-chat.tsx` filters
the strip's panes to `p.workspaceId === agent.workspaceId && p.tabId === agent.tabId`. The shipped
`fixtureAgents` are `w1:p1` (workspace `w1`, tab `w1:t1`, `blocked`, claude) and `w2:p1` (workspace
`w2`, tab `w2:t1`) — **different tabs**, which is exactly why the current file can never see
"Panes". You must build a second pane in the same tab.

**`triage()` order** (`web/src/lib/triage.ts:102`) is `needs` → `ready` → `working` → `recent`;
`needs` = `status === "blocked"`, `working` = `status === "working"`, everything else falls to
`recent`. Within a section the sort is by timestamp descending, and with no timestamps the sort is
stable, so input order is preserved.

**`panePath(paneId, session?)`** (`web/src/lib/nav.ts:6`) = `/pane/${encodeURIComponent(paneId)}` +
`sessionSearch(session)` (empty for primary). Build expectations by calling `panePath(...)`, never by
hand-encoding `%3A`.

**The hook** (`web/src/hooks/use-desktop-hotkeys.ts`): listener on `window` in the **capture** phase;
returns early unless `ctrlKey && altKey && !shiftKey && !metaKey` and the key is `ArrowUp`/
`ArrowDown`; empty agent list returns before `preventDefault`; an unknown `currentPaneId` enters at
index 0 for Down / last for Up; wraps by modulo; and **`if (!next || next.paneId === current) return`
happens before `preventDefault`** — so with a single agent nothing is prevented. Keep every hotkey
fixture at ≥ 2 agents except the empty-list case.

## 4. `web/src/components/agent-chat-desktop.test.tsx`

Rewrite the file. Keep the harness shape that already works (it renders `AgentChat` inside a
`createMemoryRouter` — `AgentChat` uses `useRevalidator`, so a data router is required, and jsdom has
no `Element.prototype.scrollTo`, which the mirror's auto-scroll calls).

```tsx
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AgentChat } from "./agent-chat";
import { setDesktop, __resetDesktop } from "@/lib/desktop";
import { fixtureAgents } from "@/test/handlers";

// Two panes in ONE tab: PaneStrip renders nothing below two, and agent-chat filters the strip to
// the current pane's workspace + tab — the shipped fixtures sit in different tabs.
const a1 = { ...fixtureAgents[0]! };                                        // w1:p1, tab w1:t1, blocked
const a2 = { ...fixtureAgents[0]!, paneId: "w1:p2", status: "working" as const };

beforeEach(() => {
  __resetDesktop();
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});
afterEach(() => { cleanup(); __resetDesktop(); });

function show() {
  const router = createMemoryRouter([{
    path: "/",
    element: (
      <AgentChat
        paneId={a1.paneId}
        agent={a1}
        agents={[a1, a2]}
        shellPanes={[]}
        text="output"
        onBack={() => {}}
        onSelect={() => {}}
      />
    ),
  }]);
  render(<RouterProvider router={router} />);
}
```

**`describe("desktop off")` — one test, all five controls present + the sheet opens:**

- `getByRole("button", { name: "Switch pane" })` is in the document
- `getByText("Panes")` is in the document
- `getByRole("button", { name: "Keys" })` is in the document
- `getByRole("button", { name: "Type into terminal" })` is in the document
- `getByRole("button", { name: "Attach image" })` is in the document
- then `fireEvent.click(screen.getByRole("button", { name: "Switch pane" }))` and
  `expect(await screen.findByRole("dialog", { name: "Switch pane" })).toBeInTheDocument()`

  The handle button and the sheet title share the string "Switch pane", so **query the sheet by
  `role: "dialog"`**, not by text — a `getByText`/`getAllByText` there is ambiguous or brittle.
  Assert the dialog is absent before the click (`queryByRole("dialog")` → `null`) so the test proves
  the click did it.

You may split "controls present" and "handle opens the sheet" into two `it`s if that reads better —
both are required either way.

**`describe("desktop on")` — `setDesktop(true)` **before** `show()`:**

- `queryByRole("button", { name: "Switch pane" })` → `null`
- `queryByText("Panes")` → `null`
- `queryByRole("button", { name: "Keys" })` → `null`
- `queryByRole("button", { name: "Type into terminal" })` → `null`
- `queryByRole("button", { name: "Attach image" })` → `null`
- **and the composer survives**: `getByPlaceholderText("Type a reply…")` and
  `getByRole("button", { name: "Send" })` are both still present.

## 5. `web/src/hooks/use-desktop-hotkeys.test.tsx`

Rewrite the file. Drop `MemoryRouter` and the `window.history.pushState` spy (it was never
asserted). Use a host component inside a `createMemoryRouter` with a pathname probe.

```tsx
import { render, screen, act, cleanup } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { useDesktopHotkeys } from "./use-desktop-hotkeys";
import { panePath } from "@/lib/nav";
import type { AgentView } from "@/lib/types";

const agent = (paneId: string, status: AgentView["status"]): AgentView => ({
  paneId, workspaceId: "w", workspaceLabel: "w", workspaceNumber: 1, tabId: "t",
  agent: "claude", status, cwd: "/tmp", focused: false,
});

// triage puts blocked first, then working, so the flattened cycle is w2:p1 → w1:p1 → w3:p1.
const AGENTS = [agent("w1:p1", "working"), agent("w2:p1", "blocked"), agent("w3:p1", "working")];
const ORDER = ["w2:p1", "w1:p1", "w3:p1"];

function Host({ agents, paneId }: { agents: AgentView[]; paneId?: string }) {
  useDesktopHotkeys({ agents, currentPaneId: paneId });
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

function mount(agents: AgentView[], paneId?: string) {
  const router = createMemoryRouter(
    [{ path: "*", element: <Host agents={agents} paneId={paneId} /> }],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

function press(init: KeyboardEventInit): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => { window.dispatchEvent(ev); });   // act() so React flushes the navigation
  return ev;
}
const where = () => screen.getByTestId("where").textContent;

afterEach(() => cleanup());
```

The `path: "*"` route keeps `Host` mounted after the hook navigates to `/pane/...`, so the probe
reads the new pathname. `panePath` is what the hook calls, so build every expectation with it.

Required cases (one `it` each):

1. **Down from the first pane goes to the next in triage order** — mount at `ORDER[0]` (`"w2:p1"`),
   press `{ key: "ArrowDown", ctrlKey: true, altKey: true }`, expect `defaultPrevented === true` and
   `where() === panePath("w1:p1")`.
2. **Up goes to the previous** — mount at `"w1:p1"`, press Ctrl+Alt+ArrowUp, expect
   `where() === panePath("w2:p1")`.
3. **Down wraps at the end** — mount at `"w3:p1"` (last), Ctrl+Alt+ArrowDown → `panePath("w2:p1")`.
4. **Up wraps at the start** — mount at `"w2:p1"` (first), Ctrl+Alt+ArrowUp → `panePath("w3:p1")`.
5. **A plain ArrowDown is not ours** — press `{ key: "ArrowDown" }` with no modifiers; expect
   `defaultPrevented === false` and `where() === "/"`.
6. **Ctrl+Alt+Left is not ours** — `{ key: "ArrowLeft", ctrlKey: true, altKey: true }`, not
   prevented, pathname unchanged.
7. **Ctrl+Shift+Alt+Down is not ours** — add `shiftKey: true`, not prevented, pathname unchanged.
8. **Empty agent list is a no-op** — mount with `[]`; Ctrl+Alt+ArrowDown is not prevented and the
   pathname stays `/`.
9. **Unmount removes the listener** — `const { unmount } = mount(AGENTS, "w2:p1"); unmount();` then
   press Ctrl+Alt+ArrowDown and expect `defaultPrevented === false`. (Dispatch after unmount is
   outside React, but keep it in `press()` for uniformity — `act()` around a no-op is harmless.)

Cases 5–8 may share one mount at `"w2:p1"` (or `[]` for 8) as long as each assertion is present.
**Every dispatch goes through `act()`** — that is an explicit review requirement.

## 6. `web/src/routes/root-title.test.tsx`

Two changes, nothing else:

1. **Build a fresh `data` per case.** Replace the module-level `const data = {...}` that case 2
   mutates (`data.agents = ...`) with a factory:

   ```tsx
   function homeData(agents: HomeData["agents"] = []): HomeData {
     return {
       bridge: "connected", device: undefined, agents, shellPanes: [], workspaces: [], tabs: [],
       sessions: [], session: undefined, snoozedUntil: null, update: undefined, error: false,
       authError: false, files: false,
     };
   }
   function show(data: HomeData) {
     const router = createMemoryRouter([{
       id: ROOT_ROUTE_ID, path: "/", loader: () => data, element: <RootLayout />,
       children: [{ index: true, element: <div /> }],
     }]);
     return render(<RouterProvider router={router} />);
   }
   ```

   Keep the existing `vi.mock` list (`use-polling`, `use-transitions`, `use-push`, `use-poll-busy`,
   `update-available-banner`, `connection-banner`) and the `afterEach(() => { cleanup();
   __resetDesktop(); })`. Add `__resetDesktop()` to `beforeEach` too.

2. **Add the third case:** `on: true` with **zero** "needs" agents → `document.title === "Collie"`.
   Set a sentinel first so the assertion proves the effect ran:

   ```tsx
   it("titles plain Collie when nothing needs you", async () => {
     document.title = "sentinel";
     setDesktop(true);
     show(homeData([]));
     await waitFor(() => expect(document.title).toBe("Collie"));
   });
   ```

   With desktop on, `RootLayout` renders `DesktopShell` (sidebar + hotkey hook). `root-desktop.test.tsx`
   already proves that renders fine with an empty agent list and the mocks above, so no extra mocking
   is needed.

The two existing cases keep their meaning: off → title untouched (`"Existing"`); on + two blocked →
`"(2) Collie"`. Pass them their own `homeData(...)` instead of the shared object.

## 7. Version bump + CHANGELOG (mandatory)

1. `herdr-plugin.toml` line 3, `package.json` line 3, `web/package.json` line 3: `0.56.1` → `0.56.2`.
   PATCH — tests only, nothing the operator has to do.
2. `CHANGELOG.md`: insert directly above `## [0.56.1] - 2026-08-22`:

   ```markdown
   ## [0.56.2] - 2026-08-22

   ### Changed
   - Desktop mode phase 1: test coverage for hidden controls, hotkeys and tab title
   ```

3. `bash scripts/check-version.sh` must print `✓`.

## 8. Verify

Run from the repo root, and judge each by its **exit status**:

```bash
cd web && bun run test          # typecheck + full vitest run — must pass
cd .. && bun run test           # bridge + scripts — must still report 859 tests
bun run typecheck               # root tsc, clean
bash scripts/check-version.sh   # prints ✓
git diff --name-only            # only the 6 files in §2, plus the 3 test files as modified
```

Sanity while iterating (fast, ~2 s): `cd web && bunx vitest run src/components/agent-chat-desktop.test.tsx
src/hooks/use-desktop-hotkeys.test.tsx src/routes/root-title.test.tsx`. Baseline before your change
is **6 tests passing**; after it should be roughly **14–16** across those three files, and the
whole-suite count should rise by the same amount with **no** other file's count changing.

Confirm no pre-730efcf test file was edited:

```bash
git diff --name-only -- 'web/src/**/*.test.tsx' 'web/src/**/*.test.ts'
```
Only `agent-chat-desktop.test.tsx`, `use-desktop-hotkeys.test.tsx`, `root-title.test.tsx` may appear.

## 9. Traps

- **Don't "fix" production to make a test pass.** The reviewer approved the code on disk. If an
  assertion fails, the assertion or the fixture is wrong — e.g. `PaneStrip` needs two panes in the
  *same* tab, and the hook deliberately skips a same-pane wrap with a single agent.
- **Ellipsis:** the placeholder is `"Type a reply…"` (U+2026). Copy it, don't type `...`.
- **Don't hand-encode pane ids** in expected paths — call `panePath()`.
- **`setDesktop(true)` goes before `render`**, not after; the store is read on first render through
  `useSyncExternalStore`.
- **`__resetDesktop()` in `beforeEach` and `afterEach`** in all three files — a leaked `on: true`
  turns unrelated tests desktop.
- **The pre-commit hook enforces the version bump.** Do the bump as part of the change, not after.
