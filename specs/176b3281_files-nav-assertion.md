# Plan — assert the Files tab lands on `/files`

## What this is

`web/src/components/bottom-nav.test.tsx` has a test called
"shows Files between Traces and Settings and navigates". It clicks the Files button but never
checks where the click went — so the "and navigates" half of the test asserts nothing. Add the
missing assertion: after the click, the location pathname is `/files`.

One file changes. Nothing else.

## Current state (already read, don't re-verify from scratch)

`web/src/components/bottom-nav.test.tsx` today:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { BottomNav } from "./bottom-nav";

describe("BottomNav files", () => {
  it("hides Files when disabled", () => { render(<MemoryRouter><BottomNav traces files={false} /></MemoryRouter>); expect(screen.queryByText("Files")).toBeNull(); });
  it("shows Files between Traces and Settings and navigates", () => {
    render(<MemoryRouter><BottomNav traces files /></MemoryRouter>);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["Spaces", "Traces", "Files", "Settings"]);
    expect(screen.getByText("Traces")).toBeTruthy();
    screen.getByText("Files").click();
  });
});
```

Facts that matter:

- `BottomNav` navigates with `useNavigate()` → `navigate(filesPath(session), { replace: true })`,
  and only when the tab isn't already active. `MemoryRouter` starts at `/`, so the Files tap does
  navigate.
- `filesPath(undefined)` returns `/files` — `sessionSearch(undefined)` is `""`, so there is no
  `?s=` suffix. The expected pathname is exactly `/files`.
- The test currently passes (`cd web && bun run test -- src/components/bottom-nav.test.tsx` →
  2 passed). It must still pass after the change.
- The rest of the Files-tab work is already in the working tree (bridge, router, nav helpers,
  version bumped to 0.53.0 with a CHANGELOG entry). Leave all of it alone.

## The change

Only `web/src/components/bottom-nav.test.tsx`.

Read the location with a small probe component rendered next to `BottomNav` inside the same
`MemoryRouter`, and click with `userEvent` so React flushes the navigation inside `act`. This is
the pattern the sibling test already uses — see `LocationProbe` in
`web/src/components/app-header.test.tsx` (lines ~16–19 and the "navigates to a session-scoped
/settings" test). Copy that shape rather than inventing a new one.

Target file content:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { BottomNav } from "./bottom-nav";

// Reads the router location so the Files tap can be checked for where it went, not just that it
// was clickable — same probe as app-header.test.tsx.
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

describe("BottomNav files", () => {
  it("hides Files when disabled", () => { render(<MemoryRouter><BottomNav traces files={false} /></MemoryRouter>); expect(screen.queryByText("Files")).toBeNull(); });
  it("shows Files between Traces and Settings and navigates", async () => {
    render(<MemoryRouter><BottomNav traces files /><LocationProbe /></MemoryRouter>);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["Spaces", "Traces", "Files", "Settings"]);
    expect(screen.getByText("Traces")).toBeTruthy();
    await userEvent.click(screen.getByText("Files"));
    expect(screen.getByTestId("loc").textContent).toBe("/files");
  });
});
```

Notes on the diff:

- The test becomes `async` — `userEvent.click` returns a promise; awaiting it is what makes the
  assertion reliable. Don't keep the bare DOM `.click()`.
- Keep the explicit `vitest` imports at the top of this file (it doesn't rely on globals) and keep
  the first test's one-line style — don't reformat lines you aren't changing.
- `getAllByRole("button")` still sees exactly the four nav buttons; `LocationProbe` renders a
  `div`, so the label-order assertion is unaffected.
- Don't add a second assertion on `?s=` — no session is passed, so there's nothing to check.

## Verify

Run from the repo root (`C:\claudeOS\Projects\tools\collie`). Judge each by exit status.

1. `cd web && bun run test -- src/components/bottom-nav.test.tsx` — 2 tests pass. (This script
   typechecks first, so a TS error fails here.)
2. `cd web && bun run test` — the whole frontend suite is green.

If step 1 fails with an "act" warning turned error, the fix is the `await userEvent.click`, not a
`waitFor` wrapper.

## Out of scope

- `adws/` — touch nothing there.
- Any new Files-tab behaviour, in the bridge or the web app.
- Another version bump or CHANGELOG entry. The working tree already carries the 0.53.0 bump that
  covers the Files tab; this test rides with it, so `scripts/check-version.sh` stays green and the
  pre-commit bump-on-change guard is already satisfied.
- Tests that already passed review — don't rewrite `bottom-nav.tsx`, `routes/files.test.tsx`, or
  the other bottom-nav test beyond what's shown above.
