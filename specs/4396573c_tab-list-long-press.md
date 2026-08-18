# Plan — long-hold a tab heading in the space list to rename/close it

## What we're doing

On the space screen the tab **chips** (`TabStrip`) already open a rename/close sheet on a long
press. The tab **list** below them does not: when "All" is selected, `SpaceView` draws each tab as a
section with a plain `<h3>` heading and holding it does nothing (on a phone it just triggers the
browser's text-selection loupe).

Make each of those headings long-pressable, opening the **same** `TabActionsSheet` the chips use.
No new sheet, no new long-press mechanism.

## Files to touch

| File | Change |
|---|---|
| `web/src/components/space-view.tsx` | New optional action props; heading becomes a long-pressable button; one `TabActionsSheet` instance |
| `web/src/routes/space.tsx` | Thread `session` / `readOnly` / `onRenamed` / `onClosed` into `<SpaceView>` |
| `web/src/components/space-view.test.tsx` | **New** test file |

Do **not** touch the bridge, `tab-strip.tsx`, `tab-actions-sheet.tsx`, `use-long-press.ts`,
`ui/chip.tsx`, the pane strip, or the swipe-up pane switcher. No new dependencies.

## Key fact that shapes the code

`groupPanesByTab` (`web/src/lib/spaces.ts`) returns `TabGroup { tabId, label, panes }` — **not** a
`TabView`. `TabActionsSheet` needs a full `TabView` (it reads `tabId`, `label`, `paneCount`). So
`SpaceView` must look the group's `tabId` back up in its existing `tabs` prop:

```ts
const tabById = new Map(tabs.map((t) => [t.tabId, t]));
```

`groupPanesByTab` also appends an **orphan group** with a synthetic id `${workspaceId}:other` and
label `…` for panes whose tab hasn't landed in the snapshot yet. That id is not in `tabs`, so the
lookup misses and the heading must stay a plain, inert `<h3>` — never guess a `TabView` for it.

## Step 1 — `web/src/components/space-view.tsx`

### 1a. Props

Add four optional props, documented the same way `TabStripProps` documents them:

```ts
  /** Session scope for the long-press tab actions (rename/close); undefined = primary. */
  session?: string;
  /** Drop the long-press write actions when the device isn't authorised (the sheet shows a note). */
  readOnly?: boolean;
  /** Revalidate after a rename. Long-press headings turn on only when this AND onClosed are set. */
  onRenamed?: () => void;
  /** Refresh/fall back after a close. Enables long-press together with onRenamed. */
  onClosed?: (tabId: string) => void;
```

Mirror `TabStrip`'s gate exactly:

```ts
const actionsEnabled = !!onRenamed && !!onClosed;
const [sheetTab, setSheetTab] = useState<TabView | null>(null);
```

Imports to add: `useState` from `react`; `TabActionsSheet` from `@/components/tab-actions-sheet`;
`useLongPress` from `@/hooks/use-long-press`; `cn` from `@/lib/utils` (only if you use it). `TabView`
is already imported as a type in this file — keep `import type` (`web/` enforces
`verbatimModuleSyntax`).

### 1b. The heading

The heading currently is:

```tsx
{selectedTab === null && (
  <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
    {g.label}
  </h3>
)}
```

Replace it with a small component in the same file (a component, **not** a callback rendering a
hook — `useLongPress` is a hook and cannot be called inside `groups.map`):

```tsx
interface TabHeadingProps {
  label: string;
  /** The tab these actions target; undefined for the synthetic orphan group (heading stays inert). */
  onLongPress?: () => void;
}

// The per-tab section heading in the "All" view. With the actions wired it is a long-pressable
// button that opens the same rename/close sheet the tab chips do; without them (or for the orphan
// group, which has no tab record) it stays a plain heading. A plain tap is deliberately a no-op:
// there is no "active" tab in this list, so a tap has nothing to mean.
function TabHeading({ label, onLongPress }: TabHeadingProps) {
  const longPress = useLongPress(onLongPress);
  const cls = "px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  if (!onLongPress) return <h3 className={cls}>{label}</h3>;
  return (
    <h3 className={cls}>
      <button
        type="button"
        aria-label={`Tab ${label} actions`}
        {...longPress}
        // select-none + -webkit-touch-callout:none stop iOS Safari's selection loupe, whose native
        // long-press gesture otherwise fires pointercancel and kills the hold timer. Deliberately NO
        // touch-action:none — the list has to keep scrolling; a scroll cancels the hold instead.
        className="select-none text-left uppercase [-webkit-touch-callout:none]"
      >
        {label}
      </button>
    </h3>
  );
}
```

Rules to respect (they're documented in `use-long-press.ts` and `ui/chip.tsx`):

- `select-none` + `[-webkit-touch-callout:none]` on the pressable element — required, not cosmetic.
- **Never** set `touch-action: none` here; the list must stay scrollable.
- Spread the hook's handlers unconditionally on the button (they're inert when
  `onLongPress` is undefined — but here we only render the button when it's defined).
- No `onClick` on the button. A tap does nothing.

Call site inside `groups.map`:

```tsx
{selectedTab === null && (
  <TabHeading
    label={g.label}
    onLongPress={
      actionsEnabled && tabById.get(g.tabId)
        ? () => setSheetTab(tabById.get(g.tabId)!)
        : undefined
    }
  />
)}
```

(Compute `const tab = tabById.get(g.tabId)` inside the map body first if you find the inline
non-null assertion ugly — either is fine, just keep it type-safe.)

### 1c. One sheet per `SpaceView`

Wrap the existing outer `<div>` in a fragment and render, after it, exactly as `TabStrip` does:

```tsx
{actionsEnabled && (
  <TabActionsSheet
    open={sheetTab !== null}
    onClose={() => setSheetTab(null)}
    tab={sheetTab}
    session={session}
    readOnly={readOnly}
    onRenamed={onRenamed}
    onClosed={onClosed}
  />
)}
```

TypeScript note: inside the `actionsEnabled &&` branch TS still sees `onRenamed`/`onClosed` as
possibly undefined (the boolean doesn't narrow them). Either gate on the values directly
(`onRenamed && onClosed && (...)`) or capture narrowed consts. Prefer gating on the values —
`onRenamed && onClosed && (...)` narrows and keeps the same behaviour.

Also: after `onClosed(tabId)` fires, the parent revalidates and the tab drops out of `tabs` —
`sheetTab` would then point at a stale record. The sheet closes itself first (`onClose()` before
`onClosed(...)` in `TabActionsSheet.requestClose`), so `sheetTab` is already null. Don't add extra
cleanup.

Update the component's header comment to mention that a heading long-press opens the tab actions
when the parent wires them.

## Step 2 — `web/src/routes/space.tsx`

Pass the same four values `TabStrip` already gets to `SpaceView`:

```tsx
<SpaceView
  workspace={selectedWs}
  tabs={data.tabs}
  agents={data.agents}
  shellPanes={data.shellPanes}
  selectedTab={tab}
  onOpen={open}
  session={data.session}
  readOnly={isReadOnly(data.device)}
  onRenamed={() => revalidator.revalidate()}
  onClosed={(tabId) => {
    if (tab === tabId) setTab(null);
    revalidator.revalidate();
  }}
/>
```

The `if (tab === tabId) setTab(null)` fallback is kept identical to `TabStrip`'s — in practice the
list headings only show under "All" (`tab === null`), so it's a no-op there, but keeping the two
call sites the same means the behaviour can't drift if the list is ever shown under a selection.
Extracting a shared `onClosed` handler const in the route and passing it to both is fine and
slightly better; do that if it reads cleanly.

Nothing else in `space.tsx` changes.

## Step 3 — `web/src/components/space-view.test.tsx` (new)

Model it on `web/src/components/tab-strip.test.tsx` (same Vitest globals — no `describe`/`it`/`expect`
imports needed; MSW server available from `@/test/setup` if you need it, though these cases don't).
A long press reaches the DOM as a `contextmenu` event, which `useLongPress` treats as an alternative
trigger — so `fireEvent.contextMenu(...)` is the established way to simulate it here.

Fixtures: two tabs in `w1` with distinct labels (e.g. `code`, `notes`) and one pane each, plus one
tab in `w2` that must not appear. Build `AgentView` objects the way the bottom of `tab-strip.test.tsx`
does. `WorkspaceView` needs `workspaceId`, `label`, `number`, `tabCount`, `paneCount` — check
`web/src/lib/types.ts` for the exact shape rather than guessing.

Cases:

1. **`selectedTab={null}` with actions wired** — `fireEvent.contextMenu(screen.getByRole("button",
   { name: "Tab code actions" }))` opens the sheet: `screen.getByRole("button", { name: "Rename" })`
   and `{ name: "Close tab" }` are present. Assert the sheet titles the right tab (the sheet's title
   is `Tab ${tab.label}` — `screen.getByText("Tab code")` or similar) so we know the *targeted* tab
   is the one held, not just "a" tab.
2. **A plain tap does nothing** — `await user.click(screen.getByRole("button", { name: "Tab code
   actions" }))` leaves `screen.queryByRole("button", { name: "Rename" })` null.
3. **No action props → no button, no sheet** — render without `onRenamed`/`onClosed`;
   `screen.queryByRole("button", { name: /Tab code actions/ })` is null, the label still renders as
   text (`screen.getByText("code")`), and a `contextmenu` on that text opens nothing.
4. **Only `onRenamed` wired stays inert** — same as (3); mirrors the TabStrip case.
5. **`selectedTab` set to a tab id → no headings at all** (the list only labels sections under
   "All"): `screen.queryByRole("button", { name: /actions$/ })` is null.

Optional but nice, matching the prompt's "fake timers" note: one case that uses
`vi.useFakeTimers()`, fires `pointerDown` on the heading button, advances past the 450 ms hold
(`vi.advanceTimersByTime(500)`), and asserts the sheet opened. If you add it, remember
`userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` for any user-event in that case, and
`vi.useRealTimers()` in a cleanup — if it fights the environment, drop it; cases 1–5 are the
required coverage.

## Verify

Run from the repo root (the operator's shell already has `bun` on PATH):

```
cd web && bun run test
```

Then typecheck both sides:

```
bun run build          # root — typechecks root tsc + web tsc, then builds
```

(or `cd web && bunx tsc --noEmit` if you only want the frontend check).

Judge each command by its **exit status**, not by scanning output text.

All existing tests must still pass — in particular `web/src/components/tab-strip.test.tsx` and
`web/src/components/tab-actions-sheet.test.tsx` are untouched and must stay green.

## Out of scope / do not do

- **No version bump and no `CHANGELOG.md` edit.** The release commit is cut afterwards on the
  branch. (`scripts/check-version.sh` stays green because all four files keep the version they
  already agree on; if the pre-commit hook objects, `SKIP_VERSION_CHECK=1 git commit …`.)
- No bridge changes, no pane strip changes, no swipe-up pane switcher changes.
- No new dependencies.
- Don't build a second sheet or a second long-press implementation.
