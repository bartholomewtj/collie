# Plan — desktop mode phase 2 finish: paste hold, Ctrl+F find, docs

**Version:** 0.56.6 → **0.56.7** (PATCH)
**Branch:** already on `feat/desktop-typing` (do not branch again; commit here)
**Repo:** `C:\claudeOS\Projects\tools\collie` (Windows, Git Bash)
**Source of truth:** `specs/desktop-mode-spec.md` §3 "Paste", §6 (Ctrl+F row), §10 phase 2.
Read that spec's **Decisions** table first — those are settled; do not re-open them.

Baselines measured 2026-08-22 before any change:

- `cd web && bun run test` → **141 files, 2781 passed | 19 todo (2800)**, typecheck clean.
- root `bun run test` → **859** (per the ask; do not change it).

## What this delivers

Three things, all behind `useDesktop().on`:

1. **Paste while captured** (direct typing armed) is no longer a silent flood of keystrokes.
   Single-line, non-destructive text still goes straight through. Anything else is *held* in the
   direct-typing strip with a one-line question and Send / Discard. A pasted image uploads and
   offers a one-click **Type path** chip — never typed unprompted.
2. **Ctrl+F** opens Collie's own find bar on the pane and history routes, but only when the
   keyboard is not captured (Ctrl+F belongs to vim/less/readline in the pane) and never on tree,
   traces, files or settings (the browser keeps it there).
3. **Docs**: a "Desktop mode" section in `README.md`, and `NEXT-SESSION.md` says phase 2 is done and
   phases 3–4 wait a week of real use.

## Ground truth in the code today (verified 2026-08-22 — re-check line numbers, they drift)

- `web/src/hooks/use-direct-typing.ts` (369 lines) owns armed state, the ordered key sender, the
  desktop keydown path (`handleDesktopKeyDown` from `lib/desktop-keymap.ts`), a **native**
  `beforeinput` listener on the textarea and a **native** `keyup` listener (Alt swallow). Native
  listeners attached to `inputRef.current` gated on `desktop && active` are the established pattern
  here — the paste listener follows it.
- `resetMode()` is the single disarm funnel: blur, idle pause, `suspended`, pane change, failed
  batch and the visibility disarm all go through it.
- `web/src/components/direct-typing-strip.tsx` defines `DirectTypingStrip({ onStop, disabled, reason })`
  — that is the file the ask means. `web/src/components/composer.tsx` renders it twice (phone
  in-flow at ~966, desktop absolutely positioned over the textarea at ~1063, `showDesktopStrip`),
  **and composer.tsx is out of scope**, so the strip cannot receive new props. State reaches it
  through a module store instead (precedent: `lib/direct-arm.ts`, `lib/haptics.ts`, `lib/desktop.ts`).
- `web/src/hooks/use-desktop-hotkeys.ts` already owns Ctrl+` and Ctrl+Alt+Up/Down on one
  **capture-phase** `window` keydown listener, mounted only by `components/desktop-shell.tsx`
  (which only renders when desktop mode is on). Because it is capture-phase it sees Ctrl+F *before*
  the textarea does — hence it needs to know whether the keyboard is captured.
- `findOpen` is local state: `components/agent-chat.tsx` (`openFind()` at ~248, which also freezes
  the tail) and `routes/history.tsx` (`setFindOpen(true)` at ~306). Neither can be reached from the
  hotkey hook today. `components/find-bar.tsx` already does Enter / Shift+Enter / Escape and
  autofocuses on mount — **it needs no new prop; do not touch it.**
- `lib/key-queue.ts` `textToKeySequence` maps `" "→Space`, `"\t"→Tab`, `"\n"→Enter`, normalises
  `\r\n?`. `lib/destructive.ts` `isDestructiveInput(text)` returns a reason string or `null`.
- `api.uploadImage(paneId, file, session?)` → `{ ok: true, path }` or `{ ok: false, error }`.
- Composer's attach button uses `onPointerDown={(e) => e.preventDefault()}` to keep focus in the
  textarea. The new strip buttons **must** do the same (see the focus trap warning below).
- Version is `0.56.6` in `herdr-plugin.toml`, `package.json`, `web/package.json`, newest CHANGELOG
  heading. Today's date for the CHANGELOG entry: **2026-08-22**.

## Files

### Touched

| File | Change |
|---|---|
| `web/src/lib/paste-hold.ts` | **new** — tiny module store for the pending paste (the strip reads it) |
| `web/src/lib/find-request.ts` | **new** — one-shot request bridge so a hotkey can open the find bar |
| `web/src/lib/direct-arm.ts` | add a published "is the keyboard captured" flag (`setDirectArmed` / `isDirectArmed` / `__resetDirectArm`) |
| `web/src/hooks/use-direct-typing.ts` | native `paste` listener when `desktop && active`; publish armed state; clear the hold on every disarm |
| `web/src/components/direct-typing-strip.tsx` | render the pending hold (question + Send/Discard, or path + Type path/Discard) |
| `web/src/hooks/use-desktop-hotkeys.ts` | Ctrl+F → `requestFindOpen()` when not captured and a pane route is showing |
| `web/src/components/agent-chat.tsx` | subscribe to the find request → `openFind()` |
| `web/src/routes/history.tsx` | subscribe to the find request → `setFindOpen(true)` |
| `README.md` | new `## Desktop mode` section + a Contents line |
| `NEXT-SESSION.md` | phase 2 done at 0.56.7; phases 3–4 wait a week |
| `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md` | 0.56.7 |

### New test files (never edit an existing test file)

`web/src/lib/paste-hold.test.ts` · `web/src/lib/find-request.test.ts` ·
`web/src/lib/direct-arm-state.test.ts` · `web/src/hooks/use-direct-typing-paste.test.tsx` ·
`web/src/components/direct-typing-strip-paste.test.tsx` ·
`web/src/hooks/use-desktop-hotkeys-find.test.tsx`

`lib/direct-arm.test.ts`, `hooks/use-direct-typing-desktop.test.tsx`,
`hooks/use-desktop-hotkeys{,-arm}.test.tsx` and `components/direct-typing-strip.test.tsx` all exist
already — leave every one of them exactly as it is.

### Two files beyond the ask's "Where" list, and why

`agent-chat.tsx` and `routes/history.tsx` own `findOpen`. There is no other way for a global hotkey
to open the find bar, and both are **absent from the Out-of-scope deny-list**, so this is in bounds.
The edit is three lines each (one `useEffect` subscribing to the bridge). Do **not** reach for
`composer.tsx`, `use-display-prefs.ts`, `use-long-press.ts` or anything under `bridge/`.

## Design

### 1. `web/src/lib/paste-hold.ts` (new, ~25 lines)

Same shape as `lib/desktop.ts` minus persistence — this must **never** be persisted; a paste that
outlived a reload would be aimed at a pane that has moved on (same reasoning as ADR 0005's key
queue).

```ts
export type PasteHold =
  | { kind: "text"; lines: number; reason: string | null; onSend: () => void; onDiscard: () => void }
  | { kind: "path"; path: string; onSend: () => void; onDiscard: () => void };
```

Exports: `pasteHold(): PasteHold | null`, `setPasteHold(h: PasteHold): void`,
`clearPasteHold(): void`, `usePasteHold(): PasteHold | null` (`useSyncExternalStore`, server
snapshot `null`), `__resetPasteHold(): void` for tests. Module-level `let hold: PasteHold | null =
null` plus a `Set` of listeners; `clearPasteHold()` on an already-null hold must still be safe and
should skip notifying (cheap guard, keeps React quiet).

`onSend` / `onDiscard` are supplied by the hook that created the hold, so the strip stays dumb.

### 2. `web/src/lib/find-request.ts` (new, ~10 lines)

Copy `lib/direct-arm.ts` verbatim in shape:

```ts
const listeners = new Set<() => void>();
export function onFindOpenRequest(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function requestFindOpen(): void { for (const fn of listeners) fn(); }
```

Header comment: the find bar's open state stays owned by the view that renders it; this is only the
desktop hotkey's way of asking.

### 3. `web/src/lib/direct-arm.ts` — publish the captured flag

Add below the existing bridge:

```ts
let armed = false;
export function setDirectArmed(on: boolean): void { armed = on; }
export function isDirectArmed(): boolean { return armed; }
export function __resetDirectArm(): void { armed = false; }
```

No subscribers needed — the only reader is a keydown handler, which reads it at event time. Comment
why it exists: the desktop hotkey listener is **capture-phase on `window`**, so it fires before the
textarea's own handler and cannot infer capture from the event target; armed state itself is still
owned by the composer/hook and still never persisted.

### 4. `web/src/hooks/use-direct-typing.ts`

**a. Publish armed state.**

```ts
useEffect(() => { setDirectArmed(desktop && active); return () => setDirectArmed(false); }, [desktop, active]);
```

**b. Clear the hold on every disarm.** Add `clearPasteHold()` as the first line of `resetMode()`
(that funnel already covers blur, idle, `suspended`, pane change, failed batch and the backgrounded
disarm) and add `useEffect(() => clearPasteHold, [])` so unmount clears too. A held paste must never
outlive the armed session that captured it.

**c. New option, defaulted so composer needs no change:**

```ts
/** Desktop paste of an image. Returns the host path, or null when the upload failed. */
uploadImage?: (file: File) => Promise<string | null>;
```

Default implementation inside the hook: split `paneKey` (composer builds it as
`` `${session ?? ""}\0${paneId}` ``) with an exported, tested helper

```ts
export function parsePaneKey(paneKey: string): { session?: string; paneId: string } | null;
```

— returns `null` when the key has no `\0` or an empty pane id; then calls
`api.uploadImage(paneId, file, session)` and returns `res.ok ? res.path : null`, setting an error
status on the failure branch. Document at the helper that the format mirrors composer's construction
and that a mismatch degrades to "no image paste", never to a wrong pane.

**d. The paste listener** (native, mirrors the existing `beforeinput` / `keyup` effects):

```ts
useEffect(() => {
  const el = inputRef.current;
  if (!desktop || !active || el === null) return;
  const onPaste = (event: ClipboardEvent) => { /* see below */ };
  el.addEventListener("paste", onPaste);
  return () => el.removeEventListener("paste", onPaste);
}, [desktop, active, inputRef, /* stable deps */]);
```

Handler order:

1. **Image first.** Index-loop `event.clipboardData?.items` (array-like, not reliably iterable —
   copy composer's loop shape). First item with `kind === "file" && type.startsWith("image/")` and a
   non-null `getAsFile()` → `event.preventDefault()`, then `void uploadPasted(file)` and return.
   `uploadPasted` awaits `uploadImage(file)`; on a path it sets
   `setPasteHold({ kind: "path", path, onSend, onDiscard })` and a status
   `"Image uploaded — tap Type path to insert it"`; on `null` it sets nothing (the default upload
   already reported the error). **Never enqueue the path itself here** — that is the whole point of
   the chip.
2. **Text.** `const raw = event.clipboardData?.getData("text/plain") ?? ""`. If empty, return
   without preventing (nothing to do). Otherwise `event.preventDefault()` — in **both** text
   branches, because letting the browser insert into the textarea hands the text to the existing
   `onChange`, which sends every character *including the newlines* with no confirmation. That is
   the bug this feature exists to close.
   - `const normalised = raw.replace(/\r\n?/g, "\n")`.
   - **Straight through:** `!normalised.includes("\n") && isDestructiveInput(normalised) === null`
     → `sender.enqueue(textToKeySequence(normalised))`. No hold, no trailing Enter (the sequence
     never contains one).
   - **Hold:** otherwise `const body = normalised.replace(/\n+$/, "")` (see below),
     `const lines = body.split("\n").length`,
     `setPasteHold({ kind: "text", lines, reason: isDestructiveInput(body), onSend, onDiscard })`.

   `onSend` = `clearPasteHold(); sender.enqueue(textToKeySequence(body)); inputRef.current?.focus();`
   `onDiscard` = `clearPasteHold(); inputRef.current?.focus();`

**Trailing newlines are stripped before the keys are built.** `textToKeySequence` maps `\n` to
`Enter`, so a copied `echo hi\n` would otherwise *run itself* the instant Send is tapped. Stripping
is how "never appends a trailing Enter" is honoured for text that carried one: interior newlines
stay as `Enter` keys, the last key is never `Enter`, and the operator presses Enter themselves when
they mean to run it. Write that reasoning at the `replace(/\n+$/, "")`.

Note the classification uses the **raw** normalised text for the newline test (per the spec:
"single-line text with no newline"), so `echo hi\n` is *held*, shown as "Paste 1 line…". Pluralise
the label (`1 line`, `2 lines`).

**No length cap.** The hold *is* the guard — a 3000-line paste says "Paste 3000 lines into the
terminal?" and Discard is one click away. Do not invent a cap.

**Phone untouched.** The listener never attaches unless `desktop && active`, so phone paste keeps
today's behaviour exactly.

### 5. `web/src/components/direct-typing-strip.tsx`

`const hold = usePasteHold();` at the top. Rendering rules:

- `disabled` (gone pane / read-only device) → unchanged: reason text, no controls, **no hold row**
  (a hold cannot be sent into a dead pane).
- `hold === null` → unchanged: "Typing into terminal — keys go straight through" + Stop.
- `hold.kind === "text"` → same icon and layout, one line:
  `Paste {n} line{s} into the terminal?` and, when `hold.reason` is non-null, ` — {hold.reason}`
  appended in the muted span (so `rm -rf` announces itself). Controls: **Send** then **Discard**.
- `hold.kind === "path"` → `Image added — {path}` (truncated by the existing `truncate` span).
  Controls: **Type path** then **Discard**.
- While a hold is pending, **Stop is not rendered** — the row is one line and the question owns it.
  Release is still available via Ctrl+`, a click outside, or Discard-then-Stop.

**Focus trap — the thing that will silently break this.** On desktop, armed *is* the textarea's own
focus, and `direct.onBlur` disarms. Clicking any button inside the strip blurs the textarea, which
would disarm the mode and (via `resetMode`) wipe the very hold you just clicked. Every new button
must therefore carry `onPointerDown={(e) => e.preventDefault()}` (the same trick composer's attach
button uses). Leave the existing Stop button alone — it means to disarm.

Buttons reuse the existing Stop button's className so the row stays visually one piece;
`type="button"` on all of them; accessible names exactly `Send`, `Discard`, `Type path`.

### 6. `web/src/hooks/use-desktop-hotkeys.ts` — Ctrl+F

Inside the existing capture-phase `onKeyDown`, after the Ctrl+` branch and before the
Ctrl+Alt+Arrow branch:

```ts
if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && (event.key === "f" || event.key === "F")) {
  if (isDirectArmed()) return;                       // Ctrl+F belongs to vim/less/readline in the pane
  if (latest.current.currentPaneId === undefined) return; // tree / traces / files / settings keep the browser's find
  event.preventDefault();
  requestFindOpen();
  return;
}
```

- The route predicate is `currentPaneId`: `DesktopShell` reads it from `useParams()`, and only
  `/pane/:paneId` and `/pane/:paneId/history` supply one. No new prop, no `useLocation`.
- Ctrl only (no Cmd/meta) — the spec's table says Ctrl+F; a mac user's Cmd+F stays the browser's.
- Not prevented when it is declined, so the browser's own find still works on tree and settings and
  the keystroke still reaches the textarea (and the mapper, which sends `ctrl+f` to the pane) while
  captured.
- `isDirectArmed` is read at event time, so no dependency churn in the effect.

### 7. Subscribers

`components/agent-chat.tsx`, next to the other find state:

```ts
useEffect(() => onFindOpenRequest(() => openFind()), []);
```

(`openFind` freezes the tail before opening — call it, not `setFindOpen`.) If lint objects to the
stale closure, hoist `openFind` into a `useCallback` or use a ref; do not widen the dependency array
into a resubscribe-per-render.

`routes/history.tsx`, next to its `findOpen`:

```ts
useEffect(() => onFindOpenRequest(() => setFindOpen(true)), []);
```

Both are no-ops until a hotkey fires, so the phone is unaffected and existing tests for these files
must keep passing untouched.

## Tests (all in new files)

**`lib/paste-hold.test.ts`** — default `null`; `setPasteHold` notifies subscribers and
`pasteHold()` returns it; `clearPasteHold()` returns to `null`; unsubscribe stops notifications;
`__resetPasteHold()` clears.

**`lib/find-request.test.ts`** — safe with no subscribers; notifies each subscriber once;
unsubscribe works. (Mirror `lib/direct-arm.test.ts`'s shape, new file.)

**`lib/direct-arm-state.test.ts`** — `isDirectArmed()` false by default; true after
`setDirectArmed(true)`; false after `setDirectArmed(false)`; `__resetDirectArm()` clears.

**`hooks/use-direct-typing-paste.test.tsx`** — copy the `Probe` from
`hooks/use-direct-typing-desktop.test.tsx` (do not edit that file), add a `usePasteHold` sentinel
component and a `sendKeys` spy, and pass a `uploadImage` stub. `beforeEach`: `localStorage.clear()`,
`clearStatus()`, `__resetPasteHold()`. Cases:

1. **single line** — paste `echo hi` → `sendKeys` called once with `textToKeySequence("echo hi")`;
   no hold; the event is `defaultPrevented`.
2. **multi-line held** — paste `echo a\necho b` → `sendKeys` not called; hold is
   `{ kind: "text", lines: 2, reason: null }`.
3. **…then sent** — call `hold.onSend()` → `sendKeys` receives a sequence containing `"Enter"`
   between the two lines and whose **last element is not `"Enter"`**; hold is cleared.
4. **trailing newline** — paste `echo hi\n` → held as `lines: 1`; after `onSend()` the sequence has
   **no `"Enter"` at all**.
5. **destructive single line** — paste `rm -rf /tmp/x` → held, `reason` matches `/rm -r/`,
   `sendKeys` not called.
6. **discard** — `hold.onDiscard()` → hold cleared, `sendKeys` never called.
7. **image paste** — clipboard with one `image/png` file item → `uploadImage` stub called with the
   file; hold becomes `{ kind: "path", path: "/host/shot.png" }`; **`sendKeys` not called**; then
   `hold.onSend()` sends `textToKeySequence("/host/shot.png")`.
8. **phone unchanged** — same paste with `desktop={false}` while armed → no hold, `sendKeys` not
   called by the paste path, event **not** `defaultPrevented`.
9. **disarm clears the hold** — hold pending, then `fireEvent.blur(textarea)` → hold is `null`.

Firing the event: try `fireEvent.paste(el, { clipboardData: { getData: () => text, items: [] } })`
first. If jsdom refuses to carry `clipboardData`, fall back to

```ts
const event = new Event("paste", { bubbles: true, cancelable: true });
Object.defineProperty(event, "clipboardData", { value: { getData: () => text, items: [] } });
act(() => { el.dispatchEvent(event); });
```

The hook's listener is a **native** one on the textarea, so a dispatched DOM event reaches it either
way. Image items stub: `{ length: 1, 0: { kind: "file", type: "image/png", getAsFile: () => file } }`
(index-loop friendly), with `file = new File(["x"], "shot.png", { type: "image/png" })`.

**`components/direct-typing-strip-paste.test.tsx`** — set the store directly, render the strip:

1. text hold renders `Paste 2 lines into the terminal?`; clicking **Send** calls `onSend`; clicking
   **Discard** calls `onDiscard`; **Stop is absent**.
2. `lines: 1` renders `Paste 1 line into the terminal?` (singular).
3. a hold with a reason renders the reason text.
4. path hold renders the path and a **Type path** button that calls `onSend`; nothing is called on
   render.
5. `pointerdown` on Send is `defaultPrevented` (focus stays in the textarea).
6. `disabled` + `reason="pane is gone"` with a hold pending → the reason shows, Send/Discard do not.

**`hooks/use-desktop-hotkeys-find.test.tsx`** — copy the mount harness from
`use-desktop-hotkeys-arm.test.tsx` (new file), `beforeEach` also `__resetDirectArm()`:

1. `currentPaneId: "p"`, not armed → Ctrl+F is `defaultPrevented` and the `onFindOpenRequest`
   listener fires once.
2. armed (`setDirectArmed(true)`) → listener not called, **not** `defaultPrevented`.
3. `currentPaneId: undefined` (tree/settings) → listener not called, not prevented.
4. Ctrl+Shift+F, Ctrl+Alt+F and bare F are not claimed.
5. after `unmount()` the listener no longer fires.

## Docs

### `README.md`

Add `- [Desktop mode](#desktop-mode)` to the Contents list (between the Configure line and
`Dark mode / light mode`), and a `## Desktop mode` section **after** "Dark mode / light mode" and
before "## Commands". Plain language, short paragraphs, practical first. Cover exactly:

- **Turning it on** — Settings → Desktop mode. Stored per browser, no auto-detect. An always-visible
  "Desktop mode is on · Turn off" strip is the way back.
- **The two typing surfaces** (Settings → Typing surface):
  - *Composer* — Enter sends, Shift+Enter makes a new line, Ctrl+Enter still sends. Esc, Tab and
    the arrows pass through to the terminal when the box is empty.
  - *Direct* — keys go straight into the terminal. Arm it by clicking the mirror or pressing
    Ctrl+` ; the strip over the input says so. It releases on Stop, Ctrl+`, a click outside, the
    window losing focus, or the idle pause. It is never remembered — a reload starts unarmed.
- **Paste while typing into the terminal** — one line of ordinary text goes straight through;
  anything with a line break, and anything that looks destructive (`rm -r`, `sudo`, `--force`),
  is held with "Paste N lines into the terminal? Send · Discard". Send keeps the line breaks as
  Enter presses but never adds one at the end, so nothing runs until you press Enter. Pasting an
  image uploads it and offers a **Type path** chip — the path is never typed for you.
- **Hotkeys** — a small table: Ctrl+` (arm / release direct typing), Ctrl+F (find in this pane or
  its history; ignored while direct typing, because the pane's own Ctrl+F should win),
  Ctrl+Alt+↑ / Ctrl+Alt+↓ (previous / next pane, "needs you" first).
- **Keys the browser keeps** — a plain list, exactly: Ctrl+T, Ctrl+W, Ctrl+N, Ctrl+Shift+N,
  Ctrl+Tab, Ctrl+Shift+T, Alt+Left / Alt+Right, F11 (the browser never hands these over), plus
  Ctrl+C **when text is selected** (copy), Ctrl+R and F5 (reload) which Collie deliberately leaves
  alone. Ctrl+C with nothing selected sends the interrupt.
- One line: Herdr cannot send Home, End, PageUp, PageDown, Insert or Delete — Collie says so instead
  of sending a look-alike.

Do not put backticked repo paths in the new section unless the file really exists —
`scripts/check-doc-links.sh` checks every backticked `web/src/…`-style path and every relative link
in `README.md`.

### `NEXT-SESSION.md`

Rewrite the header line and "Where this stopped" so a cold session is right:

- Header: main/branch at **0.56.7**, tagged when pushed; keep the host facts.
- "Where this stopped": desktop mode **phases 1 and 2 are done** — shell, sidebar, Settings card,
  Enter-sends, direct typing with the full keydown mapper, paste hold, Ctrl+F find, README section.
  **Phases 3 (mouse / right-click popover, drag-and-drop) and 4 (number-key prompt picking, History
  and Files widths) wait a week of real use** — build them only if they are actually missed
  (`specs/desktop-mode-spec.md` §10).
- Keep the existing Open / Watch out for bullets, minus the "Desktop mode phase 1" line, and note
  the branch is `feat/desktop-typing` → PR → merge → tag `v0.56.7`.

## Version bump (mandatory, do it in the same commit as the code)

`herdr-plugin.toml`, `package.json`, `web/package.json` → `0.56.7`, and `CHANGELOG.md` gains, above
`## [0.56.6]`:

```
## [0.56.7] - 2026-08-22

### Added
- Desktop mode: paste hold, Ctrl+F find, README section
```

(The house style asks for a trailing short commit hash; the ask specifies this exact line, so use it
as written.)

## Verify — every one of these must pass

```bash
cd /c/claudeOS/Projects/tools/collie
scripts/check-version.sh          # prints ✓
scripts/check-doc-links.sh        # README.md + NEXT-SESSION.md included
cd web && bun run test            # typecheck + vitest: 141+6 files, 2781 + ~28 new, 0 failed
cd .. && bun run test             # still 859
```

Judge each by its exit status, not by words in the output. No existing test file may appear in
`git diff --name-only` under a `*.test.*` name that already existed. `web/dist` is not rebuilt — this
is a source-and-docs change and `bun run build` would republish the live bundle.

## Traps

- **Do not touch `web/src/components/composer.tsx`.** It is on the deny-list. Every new piece of
  state reaches the strip through `lib/paste-hold.ts` for exactly this reason.
- **The blur/disarm trap** — any clickable thing inside the desktop strip needs
  `onPointerDown={(e) => e.preventDefault()}`, or clicking Send disarms the mode and destroys the
  hold before the click handler runs.
- **Both text paste branches must `preventDefault()`** — otherwise the browser inserts the text and
  `onChange` sends it character by character, newlines included, with no confirmation.
- **Never persist the hold** and always clear it in `resetMode()`; a paste that outlives its armed
  session would fire into a pane that has moved on.
- **Capture-phase means Ctrl+F is seen first** — the `isDirectArmed()` check is what keeps the pane's
  own Ctrl+F working, and declining must not `preventDefault()`.
- `web/` enforces `verbatimModuleSyntax` and `erasableSyntaxOnly`: `import type` for types, no
  parameter-property shorthand.
- Out of scope, leave untouched: `web/src/hooks/use-display-prefs.ts`, everything under `bridge/`,
  `web/src/hooks/use-long-press.ts`, `web/src/components/composer.tsx`, and the phase 3–4 features
  (drag-and-drop upload, right-click popover, number-key prompt picking).
