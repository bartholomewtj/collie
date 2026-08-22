# Plan — desktop mode phase 2, chunk A: composer behaviour + direct-typing arm/release

**Version:** 0.56.3 → **0.56.4** (PATCH)
**Repo:** `C:\claudeOS\Projects\tools\collie` (Windows checkout, Git Bash)
**Source spec:** `specs/desktop-mode-spec.md` §3 (*Composer surface*, and *Arm* / *Armed = focused*
under *Direct surface*) and §6 (the Ctrl+` row only). The spec's **Decisions** table is settled —
do not re-open any row in it.

## What this does

Desktop mode already has its shell, sidebar, hidden phone controls, fixed scroll regions and the
Ctrl+Alt+Up/Down pane hotkeys. This chunk makes the keyboard behave like a desktop keyboard:

- In the composer: **Enter sends, Shift+Enter inserts a newline**. Esc / Tab / arrows pass through
  to the pane when the box is empty. Ctrl+C never passes through.
- **Click the terminal (or press Ctrl+`) to type straight into it.** The existing "type into
  terminal" mode is reused — same textarea, same `useDirectTyping` hook, no second key queue.
- **Armed = focused.** The ring on the mirror and the strip over the input follow the textarea's
  own focus. Click anywhere else, alt-tab away, or hit the idle pause, and it releases.

Everything is gated on `useDesktop().on`. The phone is untouched — that is an acceptance test, not
a hope (see *Tests*).

## Baseline (measured 2026-08-22, before any edit)

| Thing | Value |
|---|---|
| `cd web && bun run test` | 134 files, **2710 passed**, 19 todo (2729 total) |
| `bun run test` (root) | **859** |
| Version in all four files | `0.56.3` |
| Newest CHANGELOG heading | `## [0.56.3] - 2026-08-22` |

After the change: web goes **up** by exactly the tests you add, root stays **859**, and **no
existing test file is edited**.

## Out of scope — do not touch

- `web/src/hooks/use-display-prefs.ts`
- anything under `bridge/`
- `web/src/hooks/use-long-press.ts`
- `web/src/lib/key-queue.ts`
- the direct-surface **keydown mapper** (`keyForKeyDown` in `use-direct-typing.ts` keeps its
  current six-key table), **modifier chords**, **paste handling** (`onPasteImage` unchanged) and
  **Ctrl+F**. Those are the next chunks of phase 2.

Note the distinction that matters: the *composer* pass-through of Esc/Tab/arrows **is** in scope
(requirement 1). The *direct-surface* mapper is not.

---

## Files

| File | Change |
|---|---|
| `web/src/lib/direct-arm.ts` | **new** — a two-function, no-state signal so Ctrl+` can reach the mounted composer. |
| `web/src/hooks/use-desktop-hotkeys.ts` | add the Ctrl+` chord: flip `typing` → `direct`, emit the arm-toggle request. |
| `web/src/hooks/use-direct-typing.ts` | new `desktop` option; draft-refusal bypass in the `on` branch; silent arm/release on desktop; `onBlur`; `window.blur` and idle-cover release; header comment. |
| `web/src/components/composer.tsx` | desktop keydown branch; imperative handle gains `armDirect` / `releaseDirect` / `toggleDirect`; `onArmedChange` prop; strip covers the input row on desktop; greyed strip when locked. |
| `web/src/components/direct-typing-strip.tsx` | optional `disabled` + `reason` props for the read-only / gone case. (**Verified path** — this is where `DirectTypingStrip` lives.) |
| `web/src/components/agent-chat.tsx` | armed state + ring; `focusFromMirror` arms on desktop; window `pointerdown` release; subscribe to the arm-toggle request. |
| `CLAUDE.md` | amend the "Type into terminal" bullet (line 196) and the glossary entry (line 332). |
| `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md` | bump to `0.56.4` + one `### Added` line. |
| 6 new test files (listed below) | — |

---

## 1. `web/src/lib/direct-arm.ts` (new)

Ctrl+` is a **global** chord handled in `useDesktopHotkeys`, mounted in `DesktopShell` at the root
of the tree. The armed state lives in `useDirectTyping` inside `<Composer>`, several levels down.
One tiny module bridges them.

```ts
// A one-shot REQUEST, not a store. Ctrl+` is handled globally (useDesktopHotkeys, mounted in
// DesktopShell); the armed state it toggles lives inside <Composer>, which is mounted only on a pane
// route. Nothing is kept here on purpose: the armed state is session-local and must not become
// something a second reader can observe, cache or restore (see use-direct-typing.ts). With no pane
// open there is simply no subscriber and the chord only flips the surface pref.
const listeners = new Set<() => void>();

export function onArmToggleRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function requestArmToggle(): void {
  for (const fn of listeners) fn();
}
```

Do **not** put this in `lib/desktop.ts`: that module persists to localStorage, and the whole point
of the armed state is that it never does.

## 2. `web/src/hooks/use-desktop-hotkeys.ts`

The existing handler opens with `if (event.shiftKey || event.metaKey || !event.ctrlKey ||
!event.altKey) return;`, which throws away every chord without Alt. Ctrl+` must be checked
**before** that line.

```ts
const onKeyDown = (event: KeyboardEvent) => {
  // Ctrl+` — arm/release direct capture. Checked before the Ctrl+Alt guard below, which discards
  // every chord without Alt. Choosing the direct surface is part of the chord: pressing it while the
  // pref still says "composer" means "type into the terminal", not "change a setting and do nothing".
  if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key === "`") {
    event.preventDefault();
    if (desktopPrefs().typing === "composer") setTyping("direct");
    requestArmToggle();
    return;
  }
  if (event.shiftKey || event.metaKey || !event.ctrlKey || !event.altKey) return;
  // ... unchanged Ctrl+Alt+Arrow block ...
};
```

Imports: `desktopPrefs`, `setTyping` from `@/lib/desktop`; `requestArmToggle` from
`@/lib/direct-arm`. Use `desktopPrefs()` (the live read), **not** `useDesktop()` — the listener is
stable across renders and must not be re-registered for a pref change. The effect's dep array stays
`[navigate]`.

The hook only ever runs inside `DesktopShell`, which renders only when desktop mode is on, so no
extra `on` check is needed.

## 3. `web/src/hooks/use-direct-typing.ts`

### 3.1 New option

Add to `DirectTypingOptions` (a required field; `composer.tsx` is the only caller):

```ts
/** Desktop mode is on. Changes three things and nothing else: arming no longer refuses over a
 *  reply draft, arming/releasing stops narrating itself (the strip over the input row is a
 *  permanent indicator, so a toast on every mirror click is noise), and losing focus releases —
 *  see the "armed = focused" note in the header. */
desktop: boolean;
```

`composer.tsx` already has `const desktop = useDesktop().on;` on the line above the
`useDirectTyping({...})` call (composer.tsx:288) — pass it straight in. Do **not** call
`useDesktop()` inside the hook; the caller owning the environment keeps the hook testable without
the store.

### 3.2 `activate()` — the draft bypass

Keep the refusal; branch it. Do **not** delete it (composer.tsx callers and
`no-echo-notice.tsx` both depend on the phone behaviour):

```ts
// A buffered reply and live keystrokes cannot safely share one field. (keep the existing comment)
//
// Desktop bypasses this, and only desktop. The refusal exists because on a phone the ONE textarea is
// both surfaces and arming would strand a draft you cannot see; in desktop mode the direct surface
// covers the input row with its own strip while the draft sits underneath untouched, and arming is a
// click on the terminal — refusing it because a half-typed reply exists would refuse the common case.
if (!desktop && replyDraft().length > 0) {
  setStatus("Send or clear the draft before typing into the terminal.", "info");
  return;
}
```

And make the arm announcement phone-only:

```ts
if (!desktop) setStatus("Typing into the terminal — keys send as you type.", "success");
```

Everything else in `activate()` (the `onActivate()` call, `cancelPendingBlur()`, the synchronous
`inputRef.current?.focus()` and the deferred `focusInput()`) is unchanged.

### 3.3 Release paths

Add one internal helper plus the wiring. **Silent** for focus loss, **spoken** for the two explicit
actions (`deactivate()` keeps its "Back to sending replies" status; Stop and Ctrl+` both route
through it).

```ts
/** Desktop's "armed = focused" release. Silent: the strip disappearing IS the signal, and this
 *  fires on every click that leaves the field — including the blur/re-arm pair a click on the
 *  mirror itself produces (blur releases, the mirror's click handler arms again in the same
 *  gesture). A status on that path would flash on every click into the terminal. */
function releaseOnFocusLoss() {
  if (!activeRef.current) return;
  resetMode();
}
```

Wire it:

- **Returned `onBlur()`** — `() => { if (desktop) releaseOnFocusLoss(); }`. Composer hands it to
  `ChatInput`'s `onBlur`. On the phone it is a no-op, so nothing changes there.
- **`window.blur`** — effect keyed on `[desktop, active]`, mounted only while `desktop && active`:
  `window.addEventListener("blur", releaseOnFocusLoss)`. **Capture must be `false`**: `blur` does
  not bubble, but a capturing window listener *does* see element blurs, and that would double up
  with `onBlur` and fire on unrelated fields.
- **Idle cover** — `const idleLocked = useLocked();` (from `@/lib/idle`, the module store the cover
  already reads). Effect: `if (!desktop || !active || !idleLocked) return; inputRef.current?.blur();
  releaseOnFocusLoss();`. Blurring first is deliberate — the requirement is that the cover *blurs*
  it, and a still-focused field behind a cover would swallow the next keystroke on resume.

Do not touch the existing `suspended`, visibility, pane-change or failed-batch disarms. Note
`suspended` (= `locked`) already covers the idle pause via the composer's `locked` prop in the
normal app; the explicit `useLocked()` rule is what the requirement asks for and what the test
asserts directly on the hook.

### 3.4 Return value

Add `onBlur` to the returned object. Everything else keeps its current name and shape.

### 3.5 Header comment (requirement 7)

In the block that currently reads *"It does NOT own the entry point. Arming is an explicit NAMED
choice — the 'Type' toggle in the composer's Controls row, beside Keys."* (lines 59-60), add a
desktop paragraph:

```
// DESKTOP MODE HAS A SECOND ENTRY POINT, AND IT IS STILL NAMED. There is no "Type" toggle on a
// desktop (the Controls row hides it); the named choice moved into Settings as the "Typing surface"
// pref, and clicking the terminal or pressing Ctrl+` arms the surface you already chose. The surface
// PREF is stored (lib/desktop.ts, localStorage). The ARMED STATE still is not, and is not lifted
// anywhere: on desktop it is simply the textarea's own focus — released by a blur, a pointerdown
// outside the field, window.blur, or the idle cover. Nothing survives a reload.
```

## 4. `web/src/components/direct-typing-strip.tsx`

Add two optional props; the armed rendering is unchanged.

```tsx
export function DirectTypingStrip(
  { onStop, disabled = false, reason }: { onStop: () => void; disabled?: boolean; reason?: string },
)
```

- `disabled: true` → muted colours (`text-muted-foreground` on the wrapper), **no Stop button**,
  and the trailing text is `— {reason}` instead of `— keys go straight through`. This is the
  read-only-device / gone-pane state: the strip still says what the surface is, and says why it
  cannot capture.
- `disabled: false` → exactly today's markup.

Keep the leading label text `Typing into terminal` identical in both states so one selector finds
it. Keep the existing header comment block (the glance-back-test note and the HostChip note).

## 5. `web/src/components/composer.tsx`

### 5.1 New prop

On `ComposerProps`:

```ts
/** Desktop mode reports the armed state up so the mirror can draw its focus ring and release on an
 *  outside pointerdown. A callback, not a lifted store — the state stays owned by the hook. */
onArmedChange?: (armed: boolean) => void;
```

Fire it from an effect: `useEffect(() => { onArmedChange?.(direct.active); }, [direct.active]);`
(deliberately not depending on the callback identity; agent-chat passes a `useState` setter, which
is stable). Add the destructure to the props list at composer.tsx:142.

### 5.2 Pass `desktop` and `typing` to the hook / render

Change composer.tsx:288 from `const desktop = useDesktop().on;` to
`const { on: desktop, typing } = useDesktop();`, and add `desktop` to the `useDirectTyping({...})`
options.

### 5.3 Imperative handle — **read the trap first**

`useImperativeHandle(ref, () => ({ focusInput: focusInputImmediately }), [])` (composer.tsx:347)
closes over `focusInputImmediately`, which only touches refs, so `[]` deps are safe today.
`direct` is a **fresh object every render**, and `direct.activate` closes over `canActivate` →
`locked`, `sending`, `uploading` from *that* render. Capturing it under `[]` deps would freeze the
first render's values and silently arm over a read-only pane.

Hold the latest hook value in a ref:

```ts
// `direct` is rebuilt every render and its activate() closes over locked/sending/uploading. The
// handle below is created once (deps []), so it must reach the CURRENT hook, never the first one's.
const directRef = useRef(direct);
directRef.current = direct;

function toggleDirect() {
  const d = directRef.current;
  if (d.active) d.deactivate();
  else d.activate();
}

useImperativeHandle(ref, () => ({
  focusInput: focusInputImmediately,
  armDirect: () => { if (!directRef.current.active) directRef.current.activate(); },
  releaseDirect: () => { if (directRef.current.active) directRef.current.deactivateSilently(); },
  toggleDirect,
}), []);
```

`ComposerHandle` (composer.tsx:33) gains the three methods, each with a one-line doc comment.

### 5.4 Ctrl+` subscription

`<Composer>` subscribes so the chord reaches the hook it belongs to:

```ts
useEffect(() => {
  if (!desktop) return;
  return onArmToggleRequest(toggleDirect);
}, [desktop]);
```

(`toggleDirect` reads `directRef`, so it is safe to leave out of the deps.)

### 5.5 The keydown branch

Replace the non-armed arm of the existing ternary (composer.tsx:955-965). The armed arm
(`direct.onKeyDown`) is unchanged.

```tsx
onKeyDown={
  direct.active
    ? direct.onKeyDown
    : (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onSendClick();
          return;
        }
        if (!desktop) return;
        // Enter sends, Shift+Enter is the newline — the desktop chat convention, and the reason the
        // phone's default is the other way round is that a phone has no comfortable Shift+Enter.
        // isComposing is load-bearing: an IME commits its candidate with Enter, and sending there
        // would fire a half-finished word AND eat the commit.
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onSendClick();
          return;
        }
        // An EMPTY box is the state right after Enter sent, and it is exactly when Esc/Tab/arrows
        // mean "drive the pane" rather than "edit this text". With text in the box they are ordinary
        // editing keys and must stay that way.
        //
        // Ctrl+C IS DELIBERATELY ABSENT and this guard is what keeps it out: an empty box is also
        // the state a reflexive copy lands in, and a reflex must never SIGINT a running agent. Ctrl
        // chords belong to the direct surface. Do not "complete" this table.
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (input.length !== 0) return;
        const key = PASS_THROUGH_KEYS[e.key];
        if (key === undefined) return;
        e.preventDefault();
        pressKeys([key]);
      }
}
```

Module-scope constant in the same file (a local six-row table, not an import — the direct-surface
mapper is a separate chunk and its table is free to change without dragging this one with it):

```ts
// Herdr's `+`-joined key grammar, not tmux: `Up`, not `C-Up`. See HERDR_API.md. Home/End/PageUp/
// PageDown/Delete are absent because Herdr rejects them — no silent look-alikes.
const PASS_THROUGH_KEYS: Readonly<Record<string, string>> = {
  Escape: "Escape", Tab: "Tab",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
};
```

`pressKeys` (composer.tsx:656) already returns early when `locked`, and already schedules the
debounced revalidate on success.

### 5.6 `onBlur` on the input

`<ChatInput ... onBlur={direct.onBlur} />`. No-op unless `desktop && active`.

### 5.7 The strip covers the input row on desktop

Two renderings now:

- **Phone (`!desktop`)** — unchanged: gate the existing line (composer.tsx:927) as
  `{!desktop && direct.active && <DirectTypingStrip onStop={() => direct.deactivate()} />}`, still
  in the in-flow strips slot above the input row.
- **Desktop** — the strip covers the input row.

Derive once, above the return:

```ts
// The strip owns the input row on desktop: while armed, or while the chosen surface is `direct` but
// the pane cannot be typed into at all. The second case is why it renders un-armed — a read-only
// device or a gone pane should be told why the surface it picked is doing nothing.
const stripReason = gone ? "pane is gone" : readOnly ? "read-only device" : null;
const showDesktopStrip = desktop && (direct.active || (typing === "direct" && stripReason !== null));
```

In the row (the `relative min-w-0 flex-1` wrapper at composer.tsx:948):

```tsx
<div className="relative min-w-0 flex-1">
  <ChatInput
    ...
    onBlur={direct.onBlur}
    className={cn("block pr-11", direct.active && "border-you …", showDesktopStrip && "opacity-0")}
  />
  {!desktop && <Button …attach… />}
  {showDesktopStrip && (
    // Covers the field rather than replacing it: the textarea must stay mounted AND focusable —
    // armed = focused, and unmounting it would blur the very thing the armed state is made of.
    <div className="absolute inset-0 flex items-center rounded-md border border-you bg-background px-2">
      <DirectTypingStrip
        onStop={() => direct.deactivate()}
        disabled={!direct.active}
        reason={stripReason ?? undefined}
      />
    </div>
  )}
</div>
```

`opacity-0` (not `hidden`, not `sr-only`): the field keeps its box, so the row does not jump, and
it stays focusable. Do **not** add `pointer-events-none` — the overlay already covers it.

And suppress the Send button while `showDesktopStrip` — the strip's Stop is the release control,
and a button left tabbable behind an opaque overlay is a keyboard trap. Wrap the existing
`{!direct.active && forcingSend ? … : … }` chain (composer.tsx:1011-1053) in
`{!showDesktopStrip && ( … )}`.

## 6. `web/src/components/agent-chat.tsx`

### 6.1 Armed state

```ts
const [armed, setArmed] = useState(false);
```

Move the `const desktop = useDesktop().on;` line (agent-chat.tsx:598) **up** next to the other
hooks near the top of the component and change it to `const { on: desktop, typing } = useDesktop();`
— `focusFromMirror` (defined at line 587) needs `typing`, and both are needed before the effects
below. `readOnly` (`isReadOnly(device)`, line 133) and `gone` (`!agent`, line 143) already exist.

### 6.2 `focusFromMirror` arms on desktop

Keep all three existing bails, with one change and one addition:

```ts
function focusFromMirror(e: ReactMouseEvent<HTMLDivElement>) {
  // Desktop ignores tapToFocus: its row is hidden in desktop mode (phase 1) and click-to-type IS
  // the arm, so a pref last set on a phone must not disable the only way in.
  if (!desktop && !prefs.tapToFocus) return;
  const target = e.target as Element | null;
  if (target?.closest?.("button, a, input, textarea, select, [role='textbox']")) return;
  // Unchanged, and now doing double duty: a click that ENDS with a live selection was a drag to
  // copy, not a request to type, so it neither focuses nor arms. Combined with the pointerdown
  // release below, selecting in the mirror while armed correctly leaves you un-armed.
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return;
  composerRef.current?.focusInput();
  if (desktop && typing === "direct") composerRef.current?.armDirect();
}
```

Arming is gated on `typing === "direct"` — that is the surface pref, and the *Arm* bullets in the
spec sit under *Direct surface*. On the composer surface a mirror click still just focuses, as
today. Ctrl+` is the escape hatch: it flips the pref to `direct` and arms in one press.

### 6.3 Release on a pointerdown outside the mirror

```ts
// Armed = focused, and a real browser mostly gets there on its own — but not reliably: Safari does
// not focus a <button> on click, so the field can keep focus through a click on a prompt option or a
// popover. This is the explicit rule. Everything that is not the composer's own field releases,
// INCLUDING a prompt button inside the mirror; a click on plain mirror text releases here too and
// the click handler above arms again in the same gesture, which is what makes a drag-to-select
// leave the mode off (the click bails on the selection and never re-arms).
useEffect(() => {
  if (!desktop || !armed) return;
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Element | null;
    if (target?.closest?.("[data-slot='chat-input']")) return;
    composerRef.current?.releaseDirect();
  };
  window.addEventListener("pointerdown", onPointerDown, true);
  return () => window.removeEventListener("pointerdown", onPointerDown, true);
}, [desktop, armed]);
```

`data-slot="chat-input"` is already on the textarea (`components/ui/chat/chat-input.tsx`).

### 6.4 Ring on the mirror

The mirror wrapper is agent-chat.tsx:777
(`<div className="min-h-0 min-w-0 flex-1 border-t border-border/40" onClick={focusFromMirror}>`):

```tsx
<div
  data-testid="mirror-region"
  className={cn(
    "min-h-0 min-w-0 flex-1 border-t border-border/40",
    // Follows the textarea's focus, not a mode flag — that is the whole contract. Inset so it does
    // not add a box and re-flow the fixed desktop layout.
    desktop && armed && "ring-2 ring-inset ring-you",
  )}
  onClick={focusFromMirror}
>
```

`cn` is already imported in this file. **Do not add a `mirrorRef`** — the release rule is "anything
that is not the field", which needs no mirror reference, and `noUnusedLocals` would fail the build.

### 6.5 Pass the callback

`<Composer ... onArmedChange={setArmed} />` (the element at agent-chat.tsx:903).

## 7. `CLAUDE.md`

Two edits. Doc-only edits do not need a bump — but this commit carries code, so the bump below
applies anyway.

**a. The bullet at line 196** — replace the entry-point clause and add the desktop sentence,
keeping the rest of the bullet verbatim:

> - **"Type into terminal" is armed by a named choice and dies with the pane view.** On the phone
>   it is the "Type" toggle in the Controls row beside Keys — never a gesture on Send, and never a
>   bare long-press. **In desktop mode the named choice is the "Typing surface" pref in Settings,
>   and a click on the mirror or Ctrl+` arms the surface you already picked; the surface PREF is
>   stored (`lib/desktop.ts`), the ARMED STATE is not — there it is simply the composer textarea's
>   own focus, released by a blur, a pointerdown outside the field, `window.blur` or the idle
>   cover.** It disarms on a pane switch, a composer lock (gone pane, read-only, idle pause), a
>   hidden page, and a failed batch — never persisted, never restored. Don't lift it, and don't add
>   the reply guard's `composerReady` pre-flight to it; …*(rest unchanged)*

**b. The glossary entry at line 332** — append: `In desktop mode the entry point is the "Typing
surface" pref plus a mirror click or Ctrl+`; the pref is stored, the armed state is not.`

## 8. Version + CHANGELOG

PATCH — this is the behaviour desktop mode was always meant to have, and no operator has to change
anything. Set `0.56.4` in `herdr-plugin.toml`, `package.json`, `web/package.json`, and add exactly:

```markdown
## [0.56.4] - 2026-08-22

### Added
- Desktop mode: Enter sends, click-to-type into the terminal, Ctrl+` to arm/release
```

Then `bash scripts/check-version.sh` must print `✓`.

---

## Tests

**Six new files. Do not edit any existing test file.** Follow the naming already in the tree
(`agent-chat-desktop.test.tsx`, `display-prefs-desktop.test.tsx`). Every desktop test resets the
store: `beforeEach(() => { localStorage.clear(); __resetDesktop(); })` and
`afterEach(() => { cleanup(); __resetDesktop(); })`.

### 1. `web/src/lib/direct-arm.test.ts`
- `requestArmToggle()` with no subscriber does not throw.
- A subscriber is called once per request; two subscribers both fire.
- The returned unsubscribe stops it.

### 2. `web/src/hooks/use-desktop-hotkeys-arm.test.tsx`
Copy the `Probe` / `mount` / `dispatch` shape from `use-desktop-hotkeys.test.tsx` (copy, don't
import — importing would mean editing that file to export them).
- Ctrl+` with `typing: "composer"` → `desktopPrefs().typing === "direct"`, the subscriber fired,
  and the event is `defaultPrevented`.
- Ctrl+` with `typing: "direct"` → still fires the request; the pref is unchanged.
- Ctrl+Shift+`, Ctrl+Alt+`, and a bare `` ` `` → not prevented, no request fired.
- Unmount → the chord no longer fires the request.
- Sanity: Ctrl+Alt+ArrowDown still navigates (the new branch didn't swallow it).

### 3. `web/src/components/composer-desktop.test.tsx`
Copy `renderComposer` / `renderComposerWithStatus` / `replyHandler` / `StatusSentinel` /
`awaitTerminalStall` from `composer.test.tsx` (they are local helpers — copy, do not export from
the existing file).

With `setDesktop(false)` (**the phone-unchanged half**):
- Enter in the composer **inserts a newline** and sends nothing (and is not `defaultPrevented`).
- Arming via the "Type into terminal" button with a non-empty draft refuses with the exact existing
  status: `Send or clear the draft before typing into the terminal.`

With `setDesktop(true)`:
- Enter with text → one guarded send (assert via the `recordReply` / `replyHandler` protocol
  already used in `composer.test.tsx`), and the event is `defaultPrevented`.
- Shift+Enter → newline, no send.
- Enter with `isComposing: true` → nothing sends and nothing is prevented. Fire it with
  `fireEvent.keyDown(input, { key: "Enter", isComposing: true })` and assert no reply call.
- Ctrl+Enter → still sends (the phone chord survives).
- Empty box: Escape / Tab / ArrowUp / ArrowDown / ArrowLeft / ArrowRight each POST
  `/api/pane/:id/keys` with exactly `["Escape"]` / `["Tab"]` / `["Up"]` / `["Down"]` / `["Left"]` /
  `["Right"]`.
- Non-empty box: Escape and ArrowUp send **no** keys (editing keys once there is text).
- Empty box, **Ctrl+C** → no `/keys` call and not `defaultPrevented`.
- Send still runs the two-tap destructive confirm: type `rm -rf /tmp/x`, click Send → status
  matches `/Destructive: .* tap Send again/` and no reply went out; click again → it sends.

Any test that fires a send it never lets verify must end with `awaitTerminalStall()`.

### 4. `web/src/components/direct-typing-strip.test.tsx`
- Default → the label, the "keys go straight through" tail, and a working Stop button that calls
  `onStop`.
- `disabled` + `reason="pane is gone"` → the reason is shown, and there is **no** Stop button.

### 5. `web/src/components/agent-chat-arm.test.tsx`
Render `AgentChat` the way `agent-chat-desktop.test.tsx` does (`fixtureAgents[0]`, a memory router,
`Element.prototype.scrollTo = () => {}`), with `setDesktop(true)` and `setTyping("direct")`.
- Clicking the mirror text arms: the strip's `Typing into terminal` label appears and the textarea
  has focus.
- Clicking the mirror while `window.getSelection()` reports a non-collapsed selection does **not**
  arm. Stub with `vi.spyOn(window, "getSelection").mockReturnValue({ isCollapsed: false } as
  Selection)`.
- With `setTyping("composer")`, clicking the mirror focuses but does **not** arm.
- Armed → the mirror wrapper carries the ring class:
  `expect(screen.getByTestId("mirror-region")).toHaveClass("ring-2")`.
- `act(() => requestArmToggle())` arms; a second call releases (the Ctrl+` path end to end,
  without needing `DesktopShell`).
- Armed, then `fireEvent.pointerDown(document.body)` → released (strip gone). Re-arm, then
  `fireEvent.pointerDown` on a button inside the mirror → also released.
- Armed, then `fireEvent.pointerDown` on the textarea itself → still armed.
- Armed, then `fireEvent.blur(window)` → released.
- `readOnly` (pass a `device` that `isReadOnly` rejects) → the greyed strip shows the read-only
  reason, has **no** Stop button, and clicking the mirror does not arm.
- `agent={undefined}` (gone pane) → same, with the gone reason.

### 6. `web/src/hooks/use-direct-typing-desktop.test.tsx`
A small probe component that calls the hook directly with a real `<textarea>`, a controllable
`replyDraft`, and `onBlur` wired to the textarea. Render a `StatusSentinel` for the refusal case.
- `desktop: false` + non-empty draft → `activate()` refuses and sets the existing status.
- `desktop: true` + non-empty draft → `activate()` arms, and the draft getter is never mutated.
- `desktop: true`, armed, then `fireEvent.blur(textarea)` → released.
- `desktop: false`, armed, then blur → **still armed** (the phone rule is untouched).
- `desktop: true`, armed, then `act(() => setLocked(true))` (from `@/lib/idle`) → the textarea is
  blurred and the mode is released.
  **Use `setLocked(false)` in `afterEach`, not `resetIdleLock()`** — `resetIdleLock` calls
  `listeners.clear()`, which would silently unsubscribe every live `useLocked()` in the suite.

---

## Verify

```bash
cd /c/claudeOS/Projects/tools/collie
cd web && bun run test          # 134+6 files; 2710 + your new tests; 0 failed
cd .. && bun run test           # still 859
bash scripts/check-version.sh   # prints ✓
git diff --stat                 # no existing *.test.* file appears
```

`cd web && bun run test` runs `bun run typecheck && vitest run`, so the web typecheck is covered by
the first command. Judge each by its **exit status**, not by scanning output for the word "error".

Do **not** run `bun run build` / `collie-ctl.sh build` — it republishes the live `web/dist` on this
host. This chunk needs no rebuild to be reviewed.

## Traps, in the order you will hit them

1. **`useImperativeHandle` with `[]` deps captures the first render's `direct`.** Use the
   `directRef` pattern in §5.3 or you get a handle that arms over a read-only pane.
2. **`window.addEventListener("blur", …, true)`** sees element blurs. Use capture `false`.
3. **`resetIdleLock()` clears subscribers** — never call it in a suite that also renders something
   using `useLocked()`. Use `setLocked(false)`.
4. **`noUnusedLocals` / `noUnusedParameters` are on everywhere**, and `web/` also enforces
   `verbatimModuleSyntax` (`import type { … }`) and `erasableSyntaxOnly`. A stray unused ref fails
   the typecheck, not just a lint.
5. **Never a `dark:` variant inside the mirror `<pre>`** — not touched here; the ring goes on the
   wrapper, not inside `AnsiOutput`.
6. **Herdr key grammar is `+`-joined, not tmux**: `Up`, `Escape`, `Tab`. `Home` / `End` / `PageUp` /
   `PageDown` / `Delete` are unsupported and are deliberately absent from `PASS_THROUGH_KEYS`.
7. `agent-chat-desktop.test.tsx` asserts a `Send` button exists on desktop. It stays green because
   `typing` defaults to `"composer"` and nothing is armed, so `showDesktopStrip` is false. If you
   change the `showDesktopStrip` condition, re-check that file.
8. The pre-commit hook blocks a functional commit without a bump; `scripts/check-version.sh` is the
   check it runs.
9. Branch, don't commit to `main`: `git checkout -b feat/desktop-typing-composer`, then push and
   `gh pr create`. The operator merges.
