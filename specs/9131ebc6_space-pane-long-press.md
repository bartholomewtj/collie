# Plan — tap-and-hold a pane row in the space list to rename or close it

## Goal

Inside a space (`/space/:spaceId`), the pane rows (`AgentCard`) only respond to a tap. Give them the
same tap-and-hold the pane pills already have: hold a row → the existing `PaneActionsSheet` opens on
that pane (Rename / Close pane, two-tap confirm). Reuse the sheet as-is. The home (herd) list must
render exactly as it does today.

Out of scope: version bump, CHANGELOG, bridge changes, new deps, any change to the herd list, the
pane switcher, or the sheet itself.

## Files to touch

1. `web/src/components/agent-card.tsx` — add optional `onLongPress`.
2. `web/src/components/space-view.tsx` — hold on each pane row → one `PaneActionsSheet`.
3. `web/src/routes/space.tsx` — pass the new `onPaneClosed` prop.
4. `web/src/components/space-view.test.tsx` — new cases.

Do **not** create `agent-card.test.tsx` (it does not exist; the prompt says skip it in that case).

## 1. `web/src/components/agent-card.tsx`

Add to `AgentCardProps`:

```ts
  /**
   * Hold-to-manage. When set, a long-press on the row opens the caller's actions sheet instead of
   * opening the pane (the hook swallows the click that follows a completed hold). Unset — the herd
   * list — leaves the row exactly as it was.
   */
  onLongPress?: () => void;
```

Destructure `onLongPress` in the component signature, then:

```ts
import { useLongPress } from "@/hooks/use-long-press";
...
const longPress = useLongPress(onLongPress);
```

Spread it on the root `<button>` **unconditionally** — with `onLongPress` undefined every handler the
hook returns is inert (each returns early), so a row with no actions behaves exactly as before:

```tsx
    <button
      type="button"
      onClick={onClick}
      {...longPress}
      className={cn(
        "w-full text-left transition-transform active:scale-[0.99]",
        // select-none + -webkit-touch-callout:none stop iOS Safari's selection loupe, whose native
        // long-press fires pointercancel and kills the hold timer. Only when the hold is wired, so
        // the herd list's markup is untouched. Deliberately NO touch-action:none — the list must
        // keep scrolling; a scroll cancels the hold through the move path instead.
        onLongPress && "select-none [-webkit-touch-callout:none]",
        flat && "transition-colors hover:bg-muted/50",
      )}
    >
```

Nothing else in the file changes — no markup, no other classes, no new elements. `useLongPress` must
be called on every render (hook rules); only the class string is conditional.

Add one line to the component's header comment: a hold opens the caller's pane actions when
`onLongPress` is wired.

## 2. `web/src/components/space-view.tsx`

- Import `PaneActionsSheet`; `AgentView` is already imported as a type.
- Add one prop, alongside the existing tab ones. Do **not** overload `onClosed`, which is typed
  `(tabId: string) => void` for tabs:

```ts
  /** Refresh after a pane is closed from a row's hold sheet — the pane drops out of the list.
   *  Wiring this AND onRenamed is what turns the pane rows' long-press on. */
  onPaneClosed?: () => void;
```

- New state next to `sheetTab`:

```ts
const [sheetPane, setSheetPane] = useState<AgentView | null>(null);
const paneActionsEnabled = !!onRenamed && !!onPaneClosed;
```

  Gate on `onPaneClosed` (not the tab `onClosed`) so the hold can never open a sheet whose close has
  no refresh behind it. `actionsEnabled` for the tab headings stays exactly as it is.

- Each card gets the hold — agents and shell panes alike, no filtering on `kind`:

```tsx
  <AgentCard
    key={p.paneId}
    agent={p}
    onClick={() => onOpen(p.paneId)}
    scope="tab"
    onLongPress={paneActionsEnabled ? () => setSheetPane(p) : undefined}
  />
```

- One sheet instance for the whole list, rendered beside the existing `TabActionsSheet` (same
  fragment, after the scroll container):

```tsx
  {paneActionsEnabled && onRenamed && onPaneClosed && (
    <PaneActionsSheet
      open={sheetPane !== null}
      onClose={() => setSheetPane(null)}
      pane={sheetPane}
      session={session}
      readOnly={readOnly}
      onRenamed={onRenamed}
      onClosed={() => onPaneClosed()}
    />
  )}
```

  `PaneActionsSheet.onClosed` is `(paneId: string) => void`; here the id is not needed — the parent
  just revalidates — so the arrow drops it. Keep `readOnly` passed through: under read-only the hold
  still opens the sheet and the sheet shows its own read-only note, same as the pill does.

- Extend the component's header comment: a hold on a pane row opens the pane actions sheet when the
  parent wires `onRenamed` + `onPaneClosed`; heading and card are separate targets, so the 0.37.0
  tab-heading hold is unaffected.

## 3. `web/src/routes/space.tsx`

On the existing `<SpaceView …>` add one line, leaving the tab `onClosed` untouched:

```tsx
  onPaneClosed={() => revalidator.revalidate()}
```

No other change to this route.

## 4. `web/src/components/space-view.test.tsx`

Keep every existing test as-is. The existing tests pass `onRenamed`/`onClosed` but not
`onPaneClosed`, so their pane rows stay inert — that is correct, and is itself one of the new
assertions.

The file already has both long-press patterns to copy: `fireEvent.contextMenu(...)`, and the fake
timer `pointerDown` + `vi.advanceTimersByTime(500)` hold.

Fixtures — the existing `pane()` helper leaves the pane unlabelled, so `paneDisplayName` returns
`"claude"` for every row. Give the new cases distinguishable names:

```ts
const labelled: AgentView = { ...pane("w1:t1", "w1:t1:p1"), paneLabel: "alpha" };
const shell: AgentView = { ...pane("w1:t2", "w1:t2:s1"), kind: "shell", paneLabel: "shell one" };
```

Pass `shellPanes={[shell]}` for the shell case. Find the row by its text
(`screen.getByText("alpha").closest("button")!`) and the sheet by role — `BottomSheet` sets
`aria-labelledby` on its title, so the dialog's accessible name is the pane's display name:
`screen.getByRole("dialog", { name: "alpha" })`. `"Close pane"` (vs the tab sheet's `"Close tab"`)
tells the two sheets apart.

Add a `describe("SpaceView — long-press pane actions", …)` with:

1. **Hold opens the pane sheet for that pane.** Render with `onOpen`, `onRenamed`, `onClosed`,
   `onPaneClosed`. `fireEvent.contextMenu` on the `alpha` row → `getByRole("dialog", { name: "alpha" })`
   exists, with `Rename` + `Close pane`. Assert nothing was open before the hold.
2. **Timer hold works too.** Inside `vi.useFakeTimers()`, `pointerDown` with `button: 0` and
   `clientX/clientY`, advance 500ms in `act`, same assertions. Restore real timers in `finally`.
3. **A plain tap opens the pane, no sheet.** `await user.click(row)` → `onOpen` called once with
   `"w1:t1:p1"`, and `screen.queryByRole("button", { name: "Close pane" })` is null.
4. **Inert without the props.** Render with only `onOpen`, and a second case with `onRenamed` +
   `onClosed` but no `onPaneClosed`: `fireEvent.contextMenu` on the row opens nothing
   (`queryByRole("button", { name: "Close pane" })` is null) and a tap still calls `onOpen`.
5. **A shell pane row gets the same sheet.** Hold the `shell one` row →
   `getByRole("dialog", { name: "shell one" })` with `Close pane`.
6. **The tab heading hold still works alongside.** In the fully-wired render, hold
   `Tab code actions` and assert the *tab* sheet (`Close tab`) opens — the two targets don't collide.

## Verify

From the repo root:

```
cd web && bunx tsc --noEmit
cd web && bun run test
```

Both must exit 0. Judge by exit status, not by words in the output. Existing `pane-strip.test.tsx`,
`pane-actions-sheet.test.tsx`, `agent-list.test.tsx` and `collie-home.test.tsx` must stay green — if
an agent-list/home test moves, the card markup was changed and must be reverted to
conditional-class-only.

Don't run a build or restart anything; this is frontend-only with no deployment step in scope.

## Notes / traps

- `useLongPress` already suppresses the click after a completed hold via `onClickCapture`, so a hold
  never also navigates. Don't add your own guard.
- Never set `touch-action: none` on the card — the space list has to scroll.
- The pane label is user text; it stays inside `<input value>` / text nodes only, which the existing
  sheet already does. Don't render it as markup.
- `web/` enforces `verbatimModuleSyntax` + `erasableSyntaxOnly` — use `import type` for type-only
  imports.
- Don't add a second gesture (swipe-to-delete, an ⋯ button) or a second sheet; the working agreement
  forbids it.
