# Plan — desktop phase 1: close the three blocking test findings

**Repo:** `C:\claudeOS\Projects\tools\collie` · branch `feat/desktop-shell` (clean tree at plan time)
**Reviewer findings:** `adws/adw_data/sessions/191ef3e8/context_handoff/review.md` → "Blocking" 1–3
**Commit under review:** `730efcf`

Production code is **approved and does not change**. This is a test-only change plus a PATCH version
bump. Three test files added by `730efcf` get expanded; nothing that existed before `730efcf` is
edited.

## Files you may touch

| File | Change |
|---|---|
| `web/src/components/agent-chat-desktop.test.tsx` | rewrite (blocking #1) |
| `web/src/hooks/use-desktop-hotkeys.test.tsx` | rewrite (blocking #2) |
| `web/src/routes/root-title.test.tsx` | add a case, stop mutating shared state (blocking #3) |
| `herdr-plugin.toml`, `package.json`, `web/package.json` | `0.56.1` → `0.56.2` |
| `CHANGELOG.md` | new `## [0.56.2] - 2026-08-22` heading with one `### Changed` line |

**Nothing else.** Out of scope: `web/src/hooks/use-display-prefs.ts`, `bridge/`,
`web/src/hooks/use-direct-typing.ts`, `web/src/hooks/use-long-press.ts`, and every non-test file in
`web/src/` (`agent-chat.tsx`, `composer.tsx`, `display-prefs.tsx`, `root.tsx`, `App.tsx`,
`desktop-shell.tsx`, `use-desktop-hotkeys.ts` all stay as committed). Do not edit any other
`*.test.ts(x)` — in particular leave `web/src/App.test.tsx` and
`web/src/components/display-prefs-desktop.test.tsx` alone; the reviewer passed both.

## Facts you need (already verified — don't re-derive)

- `web/src/lib/desktop.ts` exports `setDesktop(on)` and `__resetDesktop()`; the store is
  module-scoped with a `localStorage` mirror, so a reset between cases is mandatory.
- `web/src/test/handlers.ts` `fixtureAgents[0]` = `{ paneId: "w1:p1", workspaceId: "w1",
  tabId: "w1:t1", agent: "claude", status: "blocked" }`; `fixtureAgents[1]` is `w2:p1` in `w2:t1`.
  **Different tab** — that is why `"Panes"` never rendered.
- `PaneStrip` (`web/src/components/pane-strip.tsx:47`) returns `null` when fewer than two panes
  reach it, and `AgentChat` filters its panes to `workspaceId === agent.workspaceId &&
  tabId === agent.tabId` (`agent-chat.tsx:753-756`). Two panes in the **same** workspace + tab is the
  only way to render the strip's `SectionLabel` text `Panes`.
- Accessible names in the pane view: `button` `"Switch pane"` (the swipe handle,
  `agent-chat.tsx:849`), `button` `"Keys"` (`composer.tsx:804`), `button` `"Type into terminal"`
  (aria-label, `composer.tsx:826`), `button` `"Attach image"` (aria-label, `composer.tsx:991`),
  `button` `"Send"`, textarea placeholder `/type a reply/i`.
- The switcher sheet is `BottomSheet` with `title="Switch pane"` → `role="dialog"` with that
  accessible name, and it renders **nothing** while closed (`ui/sheet.tsx:109`). So the sheet assertion
  is `getByRole("dialog", { name: "Switch pane" })`, not another `getByRole("button", …)` — the
  handle keeps the same name after the click.
- `triage()` buckets in fixed order `needs → ready → working → recent`
  (`lib/triage.ts:43-48,102-123`): `status: "blocked"` → needs, `status: "done"` + unseen → ready,
  `status: "working"` → working, everything else (e.g. `"idle"`) → recent. One agent per bucket makes
  the flattened order deterministic without any timestamps.
- `useDesktopHotkeys` (`web/src/hooks/use-desktop-hotkeys.ts`) takes `{ agents, currentPaneId,
  session }`, listens on `window` in the **capture** phase, refuses anything with `shiftKey`/`metaKey`
  or without both `ctrlKey` and `altKey`, refuses keys other than `ArrowUp`/`ArrowDown`, returns early
  on an empty list, and returns early (no `preventDefault`) when the computed next pane is the current
  one. It then `preventDefault()`s and `navigate(panePath(next.paneId, session))`.
- `panePath(id)` = `/pane/${encodeURIComponent(id)}` plus `?s=` only when a non-primary session is
  passed. Compare against `panePath(...)` itself rather than hand-writing the encoded string.
- Baseline: the three files currently hold 6 passing tests; root `bun run test` = **859 tests**
  (839 pass / 20 skip); `bun run test` inside `web/` runs `tsc --noEmit` first.

## 1. `web/src/components/agent-chat-desktop.test.tsx` (blocking #1)

Rewrite the whole file. Requirements:

- **Fixture:** two panes in the same tab. Build the sibling from the first fixture so the workspace
  and tab match:
  ```tsx
  const primary = fixtureAgents[0]!;                                  // w1:p1 in w1:t1, blocked
  const sibling = { ...primary, paneId: "w1:p2", status: "working" as const, focused: false };
  ```
  Render with `agents={[primary, sibling]}`, `shellPanes={[]}`, `paneId={primary.paneId}`,
  `agent={primary}`, `text="recent pane output"`, `onBack`/`onSelect` no-ops — inside
  `createMemoryRouter([{ path: "/", element: <AgentChat {...props} /> }])` + `RouterProvider`
  (`AgentChat` uses `useRevalidator`, so a data router is required; copy the shape from
  `agent-chat.test.tsx:52-66`).
- **Setup:** `beforeEach(() => { localStorage.clear(); __resetDesktop(); if
  (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}; })` and
  `afterEach(() => { cleanup(); __resetDesktop(); })`. The `beforeEach` reset is what the reviewer
  asked for; keep the `afterEach` one too.
- **Case `on: false`** (no `setDesktop` call — off is the default): assert all five are present
  1. `screen.getByRole("button", { name: "Switch pane" })`
  2. `screen.getByText("Panes")` (the `PaneStrip` section label — this is the assertion the old
     fixture made impossible)
  3. `screen.getByRole("button", { name: "Keys" })`
  4. `screen.getByRole("button", { name: "Type into terminal" })`
  5. `screen.getByRole("button", { name: "Attach image" })`

  then assert the sheet is closed and opens on a tap:
  ```tsx
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Switch pane" }));
  expect(screen.getByRole("dialog", { name: "Switch pane" })).toBeInTheDocument();
  ```
- **Case `on: true`** (`setDesktop(true)` before `render`): assert the same five are **absent** with
  `queryByRole(...)` / `queryByText("Panes")` → `toBeNull()`, and that the composer still works:
  ```tsx
  expect(screen.getByPlaceholderText(/type a reply/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  ```
- Style: this repo's newer test files are dense, but prefer one assertion per line here — the reviewer
  reads them individually. Keep the file's existing header-comment habit: one short comment saying the
  fixture must share a tab or `PaneStrip` renders nothing.

## 2. `web/src/hooks/use-desktop-hotkeys.test.tsx` (blocking #2)

Rewrite the whole file. Drop `MemoryRouter` and the `pushState` spy entirely.

- **Host + probe:**
  ```tsx
  function Host({ agents, currentPaneId }: { agents: AgentView[]; currentPaneId?: string }) {
    useDesktopHotkeys({ agents, currentPaneId });
    const { pathname, search } = useLocation();
    return <div data-testid="where">{pathname}{search}</div>;
  }
  function show(agents: AgentView[], currentPaneId?: string) {
    const router = createMemoryRouter(
      [{ path: "*", element: <Host agents={agents} currentPaneId={currentPaneId} /> }],
      { initialEntries: ["/"] },
    );
    return render(<RouterProvider router={router} />);   // keep the return: unmount() is needed below
  }
  const where = () => screen.getByTestId("where").textContent;
  ```
  A splat route is deliberate — it matches `/pane/w1%3Ap1` without declaring the real route tree.
- **Agents:** one per bucket so `triage` order is fixed:
  ```tsx
  const blocked = agent("p-blocked", "blocked");   // needs
  const working = agent("p-working", "working");   // working
  const idle    = agent("p-idle",    "idle");      // recent
  const ALL = [idle, working, blocked];            // pass unsorted; triage does the ordering
  // triage order → [blocked, working, idle]
  ```
  Keep the existing `agent()` helper shape (`workspaceId: "w"`, `tabId: "t"`, `agent: "claude"`,
  `cwd: "/tmp"`, `focused: false`) typed as `AgentView`.
- **Dispatch helper** — every dispatch goes through `act()`:
  ```tsx
  function press(key: string, mods: Partial<KeyboardEventInit> = {}) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
    act(() => { window.dispatchEvent(event); });
    return event;
  }
  const CA = { ctrlKey: true, altKey: true };
  ```
- **Cases** (each its own `it`, each with a fresh `show(...)`):
  1. Ctrl+Alt+Down from the first pane (`currentPaneId: blocked.paneId`) →
     `expect(where()).toBe(panePath(working.paneId))` and the event is `defaultPrevented`.
  2. Ctrl+Alt+Up from the middle pane (`currentPaneId: working.paneId`) →
     `panePath(blocked.paneId)`.
  3. Wrap forward: Ctrl+Alt+Down from the last (`idle`) → `panePath(blocked.paneId)`.
  4. Wrap back: Ctrl+Alt+Up from the first (`blocked`) → `panePath(idle.paneId)`.
  5. Chords it does not own — after `show(ALL, blocked.paneId)`, assert
     `press("ArrowDown").defaultPrevented === false`,
     `press("ArrowLeft", CA).defaultPrevented === false`,
     `press("ArrowDown", { ...CA, shiftKey: true }).defaultPrevented === false`,
     and `expect(where()).toBe("/")` — nothing navigated.
  6. Empty agent list: `show([], undefined)`, `press("ArrowDown", CA)` → not prevented, `where()`
     still `"/"`.
  7. Unmount removes the listener: `const { unmount } = show(ALL, blocked.paneId); unmount();`
     then `expect(press("ArrowDown", CA).defaultPrevented).toBe(false);`.
- `afterEach(cleanup)` (or rely on Vitest's auto-cleanup — but be explicit, like its neighbours).
- Import `act`, `render`, `screen`, `cleanup` from `@testing-library/react`; `createMemoryRouter`,
  `RouterProvider`, `useLocation` from `react-router`; `panePath` from `@/lib/nav`.

## 3. `web/src/routes/root-title.test.tsx` (blocking #3)

Keep the mocks and the `RootLayout` harness. Two changes:

- Replace the module-level `const data = {...}` with a factory so each case gets a fresh object:
  ```tsx
  function makeData(agents: HomeData["agents"] = []): HomeData {
    return { bridge: "connected", device: undefined, agents, shellPanes: [], workspaces: [], tabs: [],
      sessions: [], session: undefined, snoozedUntil: null, update: undefined, error: false,
      authError: false, files: false } as HomeData;
  }
  function show(agents: HomeData["agents"] = []) {
    const data = makeData(agents);
    const router = createMemoryRouter([{ id: ROOT_ROUTE_ID, path: "/", loader: () => data,
      element: <RootLayout />, children: [{ index: true, element: <div /> }] }]);
    return render(<RouterProvider router={router} />);
  }
  ```
  No case may assign to another case's `data`.
- Cases:
  1. off → `document.title = "Existing"` before `show()`, stays `"Existing"`.
  2. on + two blocked agents → `"(2) Collie"` (unchanged behaviour, now via `show([agent("a"), agent("b")])`).
  3. **new** — on + zero needs agents → `"Collie"`. Use `setDesktop(true); document.title =
     "Existing"; show([]);` then `await waitFor(() => expect(document.title).toBe("Collie"))`. Setting
     the title to something else first is what proves the effect wrote `"Collie"` rather than the
     assertion passing on a default.
- Keep `afterEach(() => { cleanup(); __resetDesktop(); })`.

## 4. Version bump + CHANGELOG

PATCH — tests only, no behaviour change.

- `herdr-plugin.toml:3`, `package.json:3`, `web/package.json:3`: `0.56.1` → `0.56.2`.
- `CHANGELOG.md`: insert above `## [0.56.1] - 2026-08-22`
  ```markdown
  ## [0.56.2] - 2026-08-22

  ### Changed
  - Desktop mode phase 1: test coverage for hidden controls, hotkeys and tab title
  ```
  Use exactly that wording for the bullet.

## 5. Verify (all four must pass)

```bash
cd web && bun run test          # runs tsc --noEmit first, then Vitest; must be all-green
cd .. && bun run test           # backend: must still report "Ran 859 tests across 37 files"
bun run typecheck               # root typecheck, clean
bash scripts/check-version.sh   # must print ✓ … 0.56.2
```

Then confirm the blast radius is exactly the seven allowed files:

```bash
git status --porcelain          # only the 3 test files + 3 version files + CHANGELOG.md
git diff --stat
```

If any file that existed before `730efcf` shows up in that diff, revert it — "every file that existed
before 730efcf unedited" is part of done.

## 6. Commit

One commit on `feat/desktop-shell` (the branch is already checked out and clean). The pre-commit hook
runs the version check and the pre-push hook runs both test suites — do not use `SKIP_VERSION_CHECK`
or `SKIP_TESTS`; if a hook objects, fix the cause.

Suggested subject: `Desktop mode phase 1: cover hidden controls, hotkeys and tab title with tests`.

## Traps

- **`setDesktop` leaks between tests.** The prefs live in a module-scoped variable *and*
  `localStorage`. Without `__resetDesktop()` in `beforeEach`, a later "off" case silently runs with
  desktop on and asserts the wrong branch.
- **`"Panes"` is a `PaneStrip`-only string.** If the two fixture panes disagree on `workspaceId` or
  `tabId`, the strip renders `null` and `getByText("Panes")` throws — that was finding #1.
- **The handle and the sheet share the name "Switch pane".** Assert the sheet by `role="dialog"`, not
  by a second button lookup.
- **`use-desktop-hotkeys` never fires on a one-agent list** (`next.paneId === current` returns before
  `preventDefault`). Every navigation case needs at least two agents in distinct triage buckets.
- **Un-`act`ed dispatch.** The listener calls `navigate`, which sets router state; a bare
  `window.dispatchEvent` produces an act warning and can assert against a stale probe.
- **Encoded pane ids.** `panePath("p-blocked")` has no colon, but keep the comparison against
  `panePath(...)` anyway so a future fixture with a `w1:p1`-style id doesn't break the test.
