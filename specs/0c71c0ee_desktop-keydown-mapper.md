# Plan — desktop mode keydown mapper (phase 2, chunk 3)

**Version:** 0.56.5 → **0.56.6** (PATCH, as directed by the task)
**Repo:** `C:\claudeOS\Projects\tools\collie` (Windows checkout, Git Bash)
**Spec:** `specs/desktop-mode-spec.md` §3 "Keydown mapper". Its **Decisions** table is settled — do
not re-open it.

## What this adds

Today, when direct typing is armed, `useDirectTyping`'s `onKeyDown` only recognises six keys
(`Backspace`, `Enter`, `Escape`, `Tab`, four arrows) and reads **only** `event.key` — it never looks
at `ctrlKey` / `altKey` / `metaKey` / `shiftKey`. That is right for a phone keyboard and useless on a
desktop one: Ctrl+C, Ctrl+Shift+P, F-keys and Shift+Tab all fall through to the browser.

This chunk adds a **pure keydown mapper** (`web/src/lib/desktop-keymap.ts`) that decides, for one
`KeyboardEvent`, one of three things: send this wire key, swallow it, or leave it alone. The hook
calls it **only when `desktop` is true** (i.e. `useDesktop().on`) and only while armed. With
`on: false` nothing about `keyForKeyDown` changes.

The wire strings already exist (`composeKey` in `lib/key-queue.ts`) and the bridge passes any string
array through to Herdr. **No `bridge/` change.**

## Files

| File | Change |
|---|---|
| `web/src/lib/desktop-keymap.ts` | **new** — the pure mapper + the `preventDefault`-applying wrapper + the Alt-keyup predicate. |
| `web/src/lib/desktop-keymap.test.ts` | **new** — the table-driven test. |
| `web/src/hooks/use-direct-typing.ts` | desktop branch in `onKeyDown`; new native `keyup` effect for bare Alt. |
| `herdr-plugin.toml`, `package.json`, `web/package.json` | `0.56.5` → `0.56.6`. |
| `CHANGELOG.md` | one `### Added` line under a new `## [0.56.6] - 2026-08-22`. |

**Do not touch:** `web/src/lib/key-queue.ts` (the mapper needs no new export from it — see
"Meta / cmd" below), `web/src/hooks/use-display-prefs.ts`, `web/src/components/composer.tsx`,
`web/src/hooks/use-long-press.ts`, anything in `bridge/`, and **no existing test file**.

## 1. `web/src/lib/desktop-keymap.ts`

Pure module: no React, no `lib/status`, no DOM reads other than the event and an injected selection
getter. Everything it returns is either a wire string for `pane.send_keys` or a message for the
caller to publish.

```ts
import { composeKey, type Modifier } from "@/lib/key-queue";

export type KeyNotice = { text: string; tone: "info" | "warn" };

export type KeyAction =
  // The browser (or the textarea's own input/change path) keeps this key. NEVER preventDefault.
  | { kind: "ignore"; notice?: KeyNotice }
  // preventDefault, send nothing (bare Alt: Firefox/Windows opens its menu bar on release).
  | { kind: "swallow" }
  // preventDefault and put these on the wire.
  | { kind: "send"; keys: string[]; notice?: KeyNotice };

export interface KeyMapContext {
  /** True when the user has a live text selection (the copy reflex). Injected so the table test can
   *  drive it; defaults to `window.getSelection()`. */
  hasSelection?: () => boolean;
}

/** Pure: decide what one keydown means. Calls nothing, mutates nothing. */
export function mapKeyDown(event: KeyboardEvent, ctx?: KeyMapContext): KeyAction;

/** mapKeyDown + the one side effect: preventDefault for `send` and `swallow`, never for `ignore`. */
export function handleDesktopKeyDown(event: KeyboardEvent, ctx?: KeyMapContext): KeyAction;

/** True for a bare Alt keyup that must be preventDefaulted while captured. */
export function isAltKeyUp(event: KeyboardEvent): boolean;   // event.key === "Alt"
```

### Precedence — implement in exactly this order

Each step returns; nothing falls past its own return.

1. **IME first.** `event.isComposing || event.keyCode === 229` → `{kind:"ignore"}`. Let the IME
   finish; the composition handlers already own that text.
2. **Chords Collie owns globally** (`use-desktop-hotkeys.ts` handles them on a *capture-phase window*
   listener and already calls `preventDefault`, but does **not** `stopPropagation`, so the event
   still arrives here):
   - Ctrl+`` ` `` (ctrl only, no alt/meta/shift, `key === "\`"`)
   - Ctrl+Alt+ArrowUp / Ctrl+Alt+ArrowDown
   → `{kind:"ignore"}`. This must sit **above** the AltGr rule so the ctrl+alt arrows are not
   mistaken for AltGr.
3. **Reload reflexes** → `{kind:"ignore"}`: `key === "F5"` (any modifiers), Ctrl+R and Ctrl+Shift+R
   (`key` `"r"`/`"R"`, `ctrlKey`, no alt/meta).
4. **Copy reflex** → `{kind:"ignore"}`: `(ctrlKey || metaKey)` and no alt, `key` is `"c"`/`"C"`,
   **and** `hasSelection()` is true. Ctrl+Shift+C is deliberately not special-cased (spec §3).
   `metaKey` is included so Cmd+C still copies on a Mac — same reflex, same decision line.
5. **AltGr.** `const altGraph = (event.ctrlKey && event.altKey) || event.getModifierState?.("AltGraph") === true`.
   When true, treat ctrl and alt as **not held** for every step below (`const ctrl = altGraph ? false
   : event.ctrlKey`, same for `alt`) so `@ { | ~` on non-US layouts type through the input path.
   Do not return here — fall through.
6. **Bare Alt keydown** — `event.key === "Alt"` → `{kind:"swallow"}`.
   Bare `Control` / `Shift` / `Meta` / `AltGraph` → `{kind:"ignore"}` (nothing to send, nothing to
   suppress).
7. **Keys Herdr rejects** — `Home`, `End`, `PageUp`, `PageDown`, `Insert`, `Delete` (regardless of
   modifiers) → `{kind:"ignore", notice:{text:`Herdr can't send ${event.key}`, tone:"warn"}}`.
   No `preventDefault` (the rule is absolute), no silent look-alike. The armed textarea is empty
   between keystrokes, so leaving `Delete` to the browser does nothing visible.
8. **Base name.** Look the key up in `NAMED_KEYS`:
   `Enter→Enter`, `Backspace→Backspace`, `Tab→Tab`, `Escape→Escape`,
   `ArrowUp→Up`, `ArrowDown→Down`, `ArrowLeft→Left`, `ArrowRight→Right`,
   `" "→Space`, `F1..F12 → F1..F12` (identity).
   If not named and `event.key.length === 1`, the base is `event.key.toLowerCase()` and it counts as
   **printable**. Anything else (dead keys, unknown long names) → `{kind:"ignore"}`.
9. **No ctrl/alt/meta held:**
   - printable → `{kind:"ignore"}` — the existing input/change path types it, shift and layout
     included. **Digits land here**: while captured a digit goes to the pane raw, which is the point
     of "direct".
   - named → send. Shift still composes here, because `shift+Tab` is a real chord and the input path
     never sees Tab: `composeKey(mods, base)` with `mods = ["shift"]` when `event.shiftKey`.
10. **ctrl / alt / meta held:** `mods` = `["ctrl"]?`, `["alt"]?`, plus `"shift"` when
    `event.shiftKey` — collected in that order and handed to
    `composeKey(mods, base)`; it orders and de-dupes by `MODIFIER_ORDER` itself. Then, if
    `event.metaKey`, prefix `"cmd+"` to the result.
    Returns `{kind:"send", keys:[wire]}`, plus the Ctrl+D notice below.
11. **The one base `composeKey` cannot take.** `composeKey` passes a base containing `"+"` straight
    through untouched (it assumes a preset chord), so a modified `+` key would silently send bare
    `"+"`. Guard it: if the base is `"+"` and any modifier is held →
    `{kind:"ignore", notice:{text:"Herdr can't send +", tone:"warn"}}`.

### Meta / cmd — why `key-queue.ts` stays untouched

`Modifier` is `"ctrl" | "alt" | "shift"` and `MODIFIER_ORDER` drives the nav-tray's modifier chips
and `modifierLabel` (which returns `"⇧"` for anything that is not ctrl/alt). Widening the type to
carry `"cmd"` would put a Cmd chip in the phone's Keys tray and mislabel it. So the mapper prefixes
`"cmd+"` to `composeKey`'s result instead: `cmd+k`, `cmd+shift+p`, and the rare
`cmd+ctrl+shift+p`. The wire is order-insensitive (see the `composeKey` header comment), so a stable
local order is all that is required.

### Ctrl+C / Ctrl+D / Ctrl+Z

No confirm, no `isDangerKey` check, no two-tap — a terminal is a terminal (spec §3). They fall out
of step 10 as `ctrl+c` / `ctrl+d` / `ctrl+z`. Ctrl+D additionally carries
`notice: { text: "Sent Ctrl+D — this can close the shell.", tone: "info" }` so a shell disappearing
is never a surprise. Ctrl+C only reaches step 10 when step 4 declined, i.e. when there is no
selection.

### Exact strings the test pins

`"ctrl+c"` · `"ctrl+d"` · `"ctrl+z"` · `"ctrl+shift+p"` · `"ctrl+Space"` · `"ctrl+["` ·
`"shift+Tab"` · `"cmd+k"` · `"cmd+shift+p"` · `"Enter"` · `"Backspace"` · `"Tab"` · `"Escape"` ·
`"Up"` · `"Space"` · `"F1"` · `"F12"`.

Note the deliberate casing: modifiers lower-case, single-char bases lower-cased, **named bases
verbatim** (`Space`, `Tab`, `Up`) — that is what `composeKey` has always produced and what Herdr
verified.

## 2. `web/src/hooks/use-direct-typing.ts`

Two edits. `keyForKeyDown` and `SPECIAL_KEYS` stay exactly as they are — they remain the phone path.

**a. `onKeyDown` gains a desktop branch, before the existing body:**

```ts
function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
  if (desktop) {
    const action = handleDesktopKeyDown(event.nativeEvent);
    if (action.kind !== "swallow" && action.notice) setStatus(action.notice.text, action.notice.tone);
    if (action.kind === "send") sender.enqueue(action.keys);
    return;
  }
  const key = keyForKeyDown(event.key);
  ...unchanged...
}
```

Pass `event.nativeEvent`, not the synthetic event: the mapper is typed against the DOM
`KeyboardEvent`, and React's `preventDefault` sets the native flag anyway.

**b. New effect — bare Alt keyup.** A native listener on the same element as the existing
`beforeinput` one, in its own effect gated on `desktop && active`:

```ts
useEffect(() => {
  const inputEl = inputRef.current;
  if (!desktop || !active || inputEl === null) return;
  const onKeyUp = (event: KeyboardEvent) => { if (isAltKeyUp(event)) event.preventDefault(); };
  inputEl.addEventListener("keyup", onKeyUp);
  return () => inputEl.removeEventListener("keyup", onKeyUp);
}, [desktop, active, inputRef]);
```

A native listener rather than a new `onKeyUp` prop, because `composer.tsx` is out of scope for this
chunk — the hook must not grow a return value nobody wires up. Same reason the mapper reads the
selection itself instead of taking a new hook option.

Add a short comment above the desktop branch saying what it is and pointing at
`lib/desktop-keymap.ts`; do not restate the precedence list there.

## 3. `web/src/lib/desktop-keymap.test.ts`

One table, one `it.each` (or a `for … of` with `it()` inside `describe`), asserting **both** the
returned action and `event.defaultPrevented` for every row.

Helper — note `cancelable: true`, without which `preventDefault()` never sets `defaultPrevented`
and every row would pass vacuously:

```ts
function ev(init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
  return new KeyboardEvent("keydown", { cancelable: true, ...init });
}
```

jsdom's `KeyboardEventInit` accepts `key`, `ctrlKey`, `altKey`, `shiftKey`, `metaKey`,
`isComposing`, `keyCode` and `modifierAltGraph` (verified against the installed jsdom), and
`getModifierState("AltGraph")` reads `modifierAltGraph` — so no stubbing or `defineProperty` is
needed.

Rows (name → init → expected action → expected `defaultPrevented`). The first block is the list the
task requires; the second is the cheap remainder of the precedence table.

| Row | Event | Expect | prevented |
|---|---|---|---|
| plain char | `key:"a"` | ignore | false |
| Enter | `key:"Enter"` | send `["Enter"]` | true |
| Backspace | `key:"Backspace"` | send `["Backspace"]` | true |
| Tab | `key:"Tab"` | send `["Tab"]` | true |
| Shift+Tab | `key:"Tab", shiftKey` | send `["shift+Tab"]` | true |
| Ctrl+C, no selection | `key:"c", ctrlKey` (ctx `hasSelection: () => false`) | send `["ctrl+c"]` | true |
| Ctrl+C, selection | same, ctx `hasSelection: () => true` | ignore | false |
| Ctrl+Shift+P | `key:"P", ctrlKey, shiftKey` | send `["ctrl+shift+p"]` | true |
| Ctrl+Space | `key:" ", ctrlKey` | send `["ctrl+Space"]` | true |
| Ctrl+[ | `key:"[", ctrlKey` | send `["ctrl+["]` | true |
| AltGr+Q | `key:"@", ctrlKey, altKey` | ignore | false |
| Enter while composing | `key:"Enter", isComposing:true` | ignore | false |
| F5 | `key:"F5"` | ignore | false |
| Delete | `key:"Delete"` | ignore + notice `Herdr can't send Delete` (`warn`) | false |
| bare Alt keyup | `new KeyboardEvent("keyup",{key:"Alt"})` → `isAltKeyUp` | true | — |
| Ctrl+D | `key:"d", ctrlKey` | send `["ctrl+d"]` + notice `Sent Ctrl+D — this can close the shell.` (`info`) | true |
| Ctrl+Z | `key:"z", ctrlKey` | send `["ctrl+z"]`, **no** notice | true |
| — rest — | | | |
| keyCode 229 | `key:"Process", keyCode:229` | ignore | false |
| AltGr via modifier state | `key:"@", modifierAltGraph:true` | ignore | false |
| bare Alt keydown | `key:"Alt", altKey:true` | swallow | true |
| Ctrl+R / Ctrl+Shift+R | `key:"r", ctrlKey[, shiftKey]` | ignore | false |
| Ctrl+`` ` `` | `key:"\`", ctrlKey` | ignore | false |
| Ctrl+Alt+ArrowUp / Down | `key:"ArrowUp"/"ArrowDown", ctrlKey, altKey` | ignore | false |
| Escape / arrows | `key:"Escape"` / `"ArrowUp"` | send `["Escape"]` / `["Up"]` | true |
| bare Space | `key:" "` | send `["Space"]` | true |
| F1 / F12 | `key:"F1"` / `"F12"` | send `["F1"]` / `["F12"]` | true |
| digit while captured | `key:"5"` | ignore | false |
| Cmd+K | `key:"k", metaKey` | send `["cmd+k"]` | true |
| Cmd+Shift+P | `key:"P", metaKey, shiftKey` | send `["cmd+shift+p"]` | true |
| Home / End / PageUp / PageDown / Insert | each | ignore + notice naming that key | false |
| Ctrl++ | `key:"+", ctrlKey` | ignore + notice `Herdr can't send +` | false |

Also assert the default selection getter is not required: a row with no `ctx` and
`key:"c", ctrlKey` still resolves (jsdom's `window.getSelection()` returns a collapsed selection, so
it sends `ctrl+c`). If that turns out to be flaky in jsdom, wrap the default in a `try/catch`
returning `false` rather than editing the row.

**Phone path untouched — assert it here, do not edit an existing test file.** Add one row-free
`it()` in the same new file: nothing in `desktop-keymap.ts` is imported by the phone path, and
`use-direct-typing.ts`'s desktop branch is reached only when `desktop === true`. Prove it by
rendering nothing — instead assert in the new file that `mapKeyDown` is never consulted with
`desktop:false` by checking the hook's contract in one small probe copied from the shape used in
`use-direct-typing-desktop.test.tsx` (its `Probe` component with `desktop={false}`): fire
`keyDown` with `key:"c", ctrlKey` on the textarea and assert `sendKeys` was **not** called; then with
`desktop`, assert it was called with `["ctrl+c"]`. Put that probe in the same new test file (a
`.test.tsx`) if JSX is needed — in that case name the file `desktop-keymap.test.tsx`, keep the pure
table in it, and do not create a second file.

## 4. Version + changelog

Bump `0.56.5` → `0.56.6` in `herdr-plugin.toml`, `package.json`, `web/package.json`. Add to
`CHANGELOG.md` above `## [0.56.5]`:

```
## [0.56.6] - 2026-08-22

### Added
- Desktop mode: direct typing sends Ctrl/Alt/Shift chords and function keys
```

The task fixes the bump at PATCH; do not promote it. Cite the feature commit's short hash at the end
of the line if the feature lands as its own commit before the release commit (repo convention); a
single combined commit may omit it.

Then `bash scripts/check-version.sh` → must print `✓`.

## 5. Verification

Run from the repo root unless noted.

1. `cd web && bun run test` — typechecks both web tsconfigs, then Vitest.
   **Baseline recorded 2026-08-22: 140 files, 2740 passed + 19 todo (2759).** After this change:
   one more file, and 2740 + the number of new rows, with **zero existing tests changed or removed**.
2. `bun test` at the root — must still be **859**. Nothing in `bridge/` is touched; this is the
   sanity check that it stayed that way.
3. `git diff --stat` — the only files listed are the six in the table at the top. If an existing
   `*.test.*` file appears, the change is wrong.
4. Manual (optional, needs the bridge running and desktop mode on): arm direct typing on a Claude
   pane, press Ctrl+C on an idle prompt (interrupts), Shift+Tab (cycles Claude's mode), Ctrl+R (page
   reloads rather than reaching the pane), Delete (status says Herdr can't send it).

## 6. Traps

- **`cancelable: true`** on every constructed event, or `defaultPrevented` is always false and the
  table asserts nothing. This repo has been bitten by silently-vacuous tests before (see the
  `join()` note in `CLAUDE.md`).
- **Never `preventDefault` on an `ignore`.** Ctrl+R must reload, AltGr+Q must type `@`, Delete must
  reach nothing. The rule is one line in the wrapper; keep it there rather than sprinkling
  `preventDefault` through the branches.
- **`composeKey` swallows a `+` base.** Step 11 exists for exactly that; do not delete it as a
  "can't happen".
- **Order matters twice**: Ctrl+Alt+arrows must be checked before the AltGr rule, and the IME check
  must be first of all.
- **`event.nativeEvent`**, not the React synthetic, into the mapper.
- Bun does not hot-reload the bridge — irrelevant here (no bridge change), but a frontend change is
  only live after `bun run build`, which the ctl script also typechecks.

## Out of scope (next chunk)

Paste handling while captured (single-line vs held multi-line, `isDestructiveInput`), Ctrl+F,
`use-display-prefs.ts`, `bridge/`, `use-long-press.ts`, `composer.tsx`.
