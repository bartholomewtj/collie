# Plan — desktop mode phase 3a: right-click actions popover

**Repo:** `C:\claudeOS\Projects\tools\collie` (Windows, Git Bash)
**Branch:** `feat/desktop-mouse` (already checked out — stay on it)
**Version:** 0.56.9 → **0.56.10** (PATCH)
**Source spec:** `specs/desktop-mode-spec.md` §4 "Mouse (phase 3)". The **Decisions** table there is closed —
do not re-open it. In particular: no hover `…` button, no auto-detect, no pointer-type sniffing.

## What this is

In desktop mode (`useDesktop().on`), right-clicking a pane pill or a home-tree row (space / tab / pane)
opens the **same** action rows it opens on the phone, but in a small popover at the mouse pointer instead
of a bottom sheet. Nothing changes on the phone.

This is only the **popover half** of spec phase 3. Drag-and-drop upload is a separate task — do not build it.

## What is true in the code today (verified 2026-08-22)

- `web/src/hooks/use-long-press.ts` already treats `contextmenu` as a trigger and `preventDefault()`s it.
  `fire()` calls `onLongPress()` with **no argument**, so no pointer position reaches the sheets.
  `onLongPress: undefined` disables *everything*, including the `contextmenu` path — that is why a new
  `disabled` option is needed rather than reusing the undefined trick (Android relies on `contextmenu`).
- Four components call the hook: `components/space-tree.tsx` (`TreeRowButton`), `components/pane-strip.tsx`
  (`PanePill`), `components/ui/chip.tsx` (`Chip`), `components/agent-card.tsx` (`AgentCard`).
  Only `space-tree.tsx` and `pane-strip.tsx` currently *wire* an `onLongPress`; `Chip` and `AgentCard`
  accept the prop but no caller passes it. All four still need the type + `disabled` change.
- The three sheets (`pane-actions-sheet.tsx`, `tab-actions-sheet.tsx`, `space-actions-sheet.tsx`) are the
  same shape: `mode: "actions" | "rename"` state, a read-only note, rows from `action-sheet-rows.tsx`
  (`ActionRow` / `DestructiveActionRow` / `RenameView`), all wrapped in `<BottomSheet …>` from
  `components/ui/sheet.tsx`.
- `RenameView` already saves on Enter. It has **no** Escape handling — Escape is handled by the container's
  window `keydown` listener. The popover must do the same, so "Esc cancels" needs no change to `RenameView`.
- `components/ui/sheet.tsx` has a module-private `useDialogFocus(open, panelRef)` helper (focus in on open,
  restore on close). Export it and reuse it — don't copy it.
- `lib/desktop.ts` exists: `useDesktop() → { on, typing }`, plus `setDesktop(on)` and `__resetDesktop()`
  test seams. Test pattern to copy: `components/display-prefs-desktop.test.tsx`.
- Baselines measured on this checkout **before** any change:
  - `cd web && bun run test` → **148 files, 2812 passed, 19 todo**.
  - root `bun run test` → **859** (per the task brief).
- `git status` is clean apart from two untracked `requests/*.md` notes. Leave them alone.

## Design

### 1. `web/src/hooks/use-long-press.ts`

Add an exported point type and two option changes. Keep every existing behaviour byte-for-byte otherwise.

```ts
export interface LongPressPoint { x: number; y: number }

interface LongPressOptions {
  delayMs?: number;
  moveTolerance?: number;
  /**
   * Desktop mode. Skips ONLY the pointerdown hold timer — a mouse hold is not a gesture, a right-click is.
   * `onContextMenu` still preventDefaults and still fires, so right-click keeps working; `onClickCapture`
   * and `onReleaseAfterLongPress` are untouched. Do NOT confuse this with `onLongPress: undefined`,
   * which makes every handler inert (and would kill Android's contextmenu fallback).
   */
  disabled?: boolean;
  onReleaseAfterLongPress?: () => void;
}

export function useLongPress(
  onLongPress: ((at: LongPressPoint) => void) | undefined,
  { delayMs, moveTolerance, disabled = false, onReleaseAfterLongPress }: LongPressOptions = {},
)
```

Point resolution — one private helper, used by both trigger paths:

```ts
function pointFrom(e: { clientX?: number; clientY?: number; currentTarget?: unknown }): LongPressPoint {
  const x = e.clientX || 0;
  const y = e.clientY || 0;
  if (x !== 0 || y !== 0) return { x, y };
  // A keyboard-raised context menu (Menu key, Shift+F10) carries no coordinates. Anchor on the row itself
  // so the popover still lands on the thing it acts on.
  const rect = (e.currentTarget as HTMLElement | undefined)?.getBoundingClientRect?.();
  return rect ? { x: rect.left, y: rect.bottom } : { x: 0, y: 0 };
}
```

- `fire` becomes `fire(at: LongPressPoint)` and calls `onLongPress(at)`. Idempotency per gesture is unchanged.
- `onPointerDown`: keep the existing order — bail on `!onLongPress`, then reset `fired`/`releaseHandled`,
  then bail on `e.button !== 0`. Add `if (disabled) return;` **after** those, so a disabled hold still resets
  the one-shot flag (a second right-click must be able to re-open). Compute the point **synchronously**
  (`const at = pointFrom(e)`) before arming the timer — `currentTarget` is null once dispatch ends — and
  arm `setTimeout(() => fire(at), delayMs)`.
- `onContextMenu`: unchanged except `fire(pointFrom(e))`. Still `preventDefault()`s whenever `onLongPress`
  is set, disabled or not.
- The existing tests call the handlers with minimal synthetic objects that have no `currentTarget` and no
  `clientX` — `pointFrom` must survive that (hence `|| 0` and `?.`). They assert call **counts**, never
  arguments, so passing a point does not break them. **Do not edit that file.**
- Update the hook's doc block: one sentence naming `disabled` as the desktop-mode switch and one naming the
  `{x,y}` payload.

### 2. New container — `web/src/components/ui/popover.tsx`

A minimal anchored popover in the house style: no Radix, no portal, renders nothing when closed.

```ts
export interface ActionPopoverProps {
  open: boolean;
  onClose: () => void;
  /** Viewport coordinates from the long-press hook. Null or {0,0} → clamped to the top-left inset. */
  anchor: { x: number; y: number } | null;
  title?: string;
  children: React.ReactNode;
  className?: string;
}
export function ActionPopover(props: ActionPopoverProps): React.ReactElement | null
```

Behaviour:

- Root `div` is `position: fixed`, `data-testid="action-popover"`, `role="dialog"`, `tabIndex={-1}`,
  `aria-labelledby` the title (same `useId()` pattern as `BottomSheet`). **No `aria-modal`** and **no
  backdrop element** — the page behind stays visible and usable; that is the desktop expectation and it
  keeps this honest about not being modal.
- Header: the title as a small `text-sm font-semibold` line. **No ✕ button** — Escape and an outside
  pointerdown are the dismissals, and a ✕ would be the "second way out" the phone sheet already owns.
- Sizing/position: `min-w-[13rem] max-w-[16rem]`, `rounded-lg border-2 border-foreground bg-card shadow-lg`,
  `z-50`, `p-2`. Compute `left`/`top` in a `useLayoutEffect` after mount: start from the anchor, measure
  `panelRef.current.getBoundingClientRect()`, and clamp so the panel stays inside
  `window.innerWidth/innerHeight` with an 8px margin. A null or `{0,0}` anchor clamps to `(8, 8)`.
  jsdom reports zero sizes, so the clamp math degrades to "the anchor, floored at 8" — that is what the
  tests assert.
- Focus: reuse `useDialogFocus` (export it from `sheet.tsx`) so focus moves into the panel on open and
  returns to the opener on close. This is what makes the rename input reachable and Escape land on us.
- Escape: `window.addEventListener("keydown", …)` while open, `e.key === "Escape"` → `onClose()`.
- Outside dismiss: `window.addEventListener("pointerdown", handler, true)` while open; if
  `panelRef.current?.contains(e.target as Node)` do nothing, else `onClose()`. Capture phase so a click on a
  tree row closes it before that row navigates.
- Both listeners are added on open and removed on close/unmount.

### 3. The three sheets — same body, different container

For each of `pane-actions-sheet.tsx`, `tab-actions-sheet.tsx`, `space-actions-sheet.tsx`:

1. Add one optional prop:
   ```ts
   /** Where the right-click happened, from useLongPress. Desktop mode only — the phone sheet ignores it. */
   anchor?: { x: number; y: number } | null;
   ```
   Default `null`.
2. Pull the existing JSX children of `<BottomSheet>` out into a local `const body = readOnly ? … : mode === "actions" ? … : <RenameView … />;`. **Do not change a single row, label, handler or comment inside it** — this is a container swap, not a rewrite.
3. Pick the container:
   ```tsx
   const desktop = useDesktop().on;
   const title = /* the exact existing title expression */;
   return desktop ? (
     <ActionPopover open={open} onClose={onClose} anchor={anchor} title={title}>{body}</ActionPopover>
   ) : (
     <BottomSheet open={open} onClose={onClose} title={title}>{body}</BottomSheet>
   );
   ```
4. Nothing else changes: the rename mode toggle, the autofocus effect, `usePendingConfirm` two-step close,
   the read-only note and every API call stay exactly as they are. Two-step close therefore stays two-step
   in the popover, and Escape (popover level) cancels a rename by closing — no `RenameView` change.
5. `action-sheet-rows.tsx` needs **no logic change**. Only if a row's `active:` styling reads oddly under a
   mouse do you touch it — prefer leaving it alone; a hover style already exists on `ActionRow`.

### 4. Callers

Every component that calls `useLongPress` passes `disabled` from the store and nothing else:

```tsx
const desktop = useDesktop().on;
const longPress = useLongPress(onLongPress, { disabled: desktop });
```

- `components/space-tree.tsx` → `TreeRowButton`; prop type becomes `onLongPress?: (at: LongPressPoint) => void`.
- `components/pane-strip.tsx` → `PanePill`; same type change.
- `components/ui/chip.tsx` → `Chip`; same type change (no caller wires it today; keep it consistent).
- `components/agent-card.tsx` → `AgentCard`; same type change.

Never branch on pointer type, `matchMedia`, viewport width or `navigator.maxTouchPoints`. `useDesktop().on`
is the only input.

Anchor plumbing (one `anchor` state per component — only one sheet is open at a time):

- `space-tree.tsx`: add `const [sheetAnchor, setSheetAnchor] = useState<LongPressPoint | null>(null);`.
  Each of the three `onLongPress` props becomes `(at) => { setSheetAnchor(at); setSheetSpace(w); }` (and the
  tab / pane equivalents). Pass `anchor={sheetAnchor}` to all three sheets.
- `pane-strip.tsx`: same one state; the long press sets it, `onTapActive` sets it to `null` (a tap has no
  meaningful pointer anchor and `PaneStrip` is not rendered in desktop mode anyway). Pass `anchor` to
  `PaneActionsSheet`.

## Tests — new files only, nothing existing edited

`web/src/hooks/use-long-press-desktop.test.tsx` (new — `.tsx` because it renders a real element):

- A tiny harness: `function Row({ onLongPress, disabled }) { const lp = useLongPress(onLongPress, { disabled }); return <button {...lp}>row</button>; }`.
- `disabled: true` — a `pointerdown` held past 450 ms fires **nothing** (fake timers).
- `disabled: true` — `fireEvent.contextMenu(row, { clientX: 120, clientY: 200 })` fires `onLongPress` once
  with `{ x: 120, y: 200 }`, and the dispatched event is `defaultPrevented`.
- `disabled: true` — a second right-click after the first still re-opens (the one-shot flag reset survives).
- `disabled: false` (the phone) — the held pointerdown still fires after 450 ms, with the pointerdown's
  coordinates; `contextmenu` still fires and is `defaultPrevented`. This is the "Android unchanged" guard.
- Rect fallback: stub `getBoundingClientRect` on the rendered button to `{ left: 40, bottom: 90, … }`, fire
  `contextmenu` with no coordinates (keyboard Menu key) → `onLongPress` receives `{ x: 40, y: 90 }`.

`web/src/components/ui/popover.test.tsx` (new):

- Renders nothing when `open={false}`.
- Renders children and positions the panel at the anchor (`style.left === "120px"`, `style.top === "200px"`).
- A null anchor (and `{x:0,y:0}`) clamps to the 8px inset instead of the viewport edge.
- Escape calls `onClose`.
- `pointerdown` on `document.body` calls `onClose`; `pointerdown` inside the panel does not.
- Labelled by its title; focus is inside the panel after open.

`web/src/components/pane-actions-sheet-desktop.test.tsx`,
`web/src/components/tab-actions-sheet-desktop.test.tsx`,
`web/src/components/space-actions-sheet-desktop.test.tsx` (new, one per sheet;
`afterEach(() => { cleanup(); __resetDesktop(); })`):

- `setDesktop(true)` + `anchor={{ x: 120, y: 200 }}` → the same rows are on screen (`Rename`, and
  `Close pane` / `Close tab` for those two; space has rename only) **inside** `getByTestId("action-popover")`,
  positioned at the anchor. No bottom-sheet backdrop (`container.querySelector('button[aria-hidden="true"]')`
  is null).
- Desktop off (default) → the bottom sheet renders as today: the backdrop exists and there is no
  `action-popover`.
- Desktop on → tapping `Rename` still swaps to the prefilled input inside the popover (the shared body
  really is shared), and Escape closes it.

Do not touch `use-long-press.test.ts`, `pane-actions-sheet.test.tsx`, `tab-actions-sheet.test.tsx`,
`space-actions-sheet.test.tsx`, `space-tree.test.tsx`, `pane-strip.test.tsx` or `ui/sheet.test.tsx`.
If one of them fails, the change is wrong — fix the change, not the test.

## Docs — `CLAUDE.md`

Extend the existing "Tap-and-hold is the one way to manage a pane, tab or space in place" bullet (~line 185)
with the desktop exception, in the file's voice:

> **Desktop mode is the one exception, and it is a container swap, not a second sheet.** With
> `useDesktop().on`, `useLongPress({ disabled: true })` turns off the hold timer — a mouse hold is not a
> gesture — while `contextmenu` keeps firing, so right-click opens the *same* rows from
> `action-sheet-rows.tsx` in a popover at the pointer (`components/ui/popover.tsx`, anchored on the `{x,y}`
> the hook passes; a keyboard Menu key gives `{0,0}` and falls back to the row's rect). Rename is still the
> inline `RenameView`, close is still two-step. Still no hover `…` button, no swipe-to-delete, no second
> set of rows.

Also add `components/ui/popover.tsx` to the "Long-press actions" row of the big-pieces table in the system map.

No other doc changes. `README.md`, `ARCHITECTURE.md` and the ADRs stay as they are — this is an exception
recorded in the rule it excepts, not a new decision record.

## Version bump — mandatory

1. `herdr-plugin.toml`, `package.json`, `web/package.json`: `0.56.9` → `0.56.10`.
2. `CHANGELOG.md`, new heading directly above `## [0.56.9]`:

```
## [0.56.10] - 2026-08-22

### Added
- Desktop mode: right-click opens the pane, tab and space actions in a popover at the pointer
```

Use that line verbatim — a gate checks it.

3. `bash scripts/check-version.sh` must print `✓`.

## Verify (all must pass before you stop)

```bash
cd web && bun run test      # ≥ 2812 passed, 0 failed; file count 148 + your new files
cd .. && bun run test       # 859, unchanged
bun run typecheck           # clean (root); web typecheck runs inside `cd web && bun run test`
bash scripts/check-version.sh
git diff --name-only        # no existing *.test.* file appears
```

Judge each by its exit status, not by grepping the output for the word "error".

Then commit on `feat/desktop-mouse`: one functional commit, then the release commit with the version bump
and CHANGELOG. Push and open the PR with `gh pr create` (the operator merges). Do not tag — the tag rides
the release when the operator merges.

## Out of scope — do not touch

- `web/src/hooks/use-display-prefs.ts`
- anything under `bridge/`
- `web/src/components/composer.tsx`, `web/src/hooks/use-direct-typing.ts`
- drag-and-drop upload (the other half of spec phase 3 — separate task)
- a hover `…` affordance, a second gesture, or any pointer-type / viewport detection
