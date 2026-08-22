# Plan — desktop mode

**Version:** 0.55.2 → **0.56.0** (MINOR — a new surface and new settings)
**Repo:** `C:\claudeOS\Projects\tools\collie` (Windows checkout, Git Bash)
**Status:** v2, 2026-08-22. Interview → draft → six-lens council review → this revision. Ready to build.

## What this is

Collie is a phone UI. Open it in a desktop browser today and you get a phone-width column, a bottom
tab bar, long-press menus, a special-keys pad, and a text box where Enter inserts a newline. Desktop
mode is a **manual switch in Settings** that keeps the same bridge, the same URL and the same
polling, but swaps the controls for ones that fit a keyboard and a mouse:

- a **sidebar + one pane** layout (tree on the left, selected pane on the right)
- **direct typing** that sends every key the browser lets us catch, including Ctrl chords
- **right-click** menus instead of long-press bottom sheets
- a small set of **hotkeys**
- the phone-only bits (keys pad, haptics, camera-roll picker) hidden

Nothing changes for the phone. That is an acceptance test, not a hope (see §9).

## Decisions (do not re-open these)

| Topic | Decision |
|---|---|
| Switching on | Manual toggle in Settings, stored per browser. No auto-detect. |
| Layout | Sidebar (fixed 280 px) + one pane. Not split panes. Not resizable. |
| Traces / Files / Settings | Bottom of the sidebar. No bottom bar in desktop mode. |
| Typing | Two surfaces, composer and direct. A pref picks the surface; **armed state is never persisted** (keeps the existing rule). |
| Key capture | Send everything the browser lets us, except the copy/reload reflexes (§3). Browser-reserved chords are documented. |
| Keys pad | Always hidden on desktop. |
| Mouse actions | Right-click opens the existing action rows in a popover at the pointer. **No hover `…` button** (removed after council review; CLAUDE.md "no second gesture" rule). |
| Pane size | Do **not** resize the real tmux/Herdr pane. No bridge change. |
| Prompt buttons | Keep them when raw terminal is off; clickable. Number-key picking is phase 4 (§10). |
| Idle lock | Keep on desktop, 2 h. It is a polling pause, not a lock (ADR 0007); say so in the UI. |
| Haptics | Hide the setting on desktop. |
| Image send | Paste (exists today). Drag-and-drop is phase 3. Attach button hidden. |
| Push | Keep. |
| Focus | Click the mirror to capture keys; ring shows it. Release via Stop button, sidebar click, or the mode chord. **No Esc-Esc.** |
| Tab title | `(n) Collie` when n agents need you, desktop only. No `setAppBadge`. |
| Hotkeys | Ctrl+` toggles direct capture; Ctrl+F find (only when not captured); Ctrl+Alt+Up / Ctrl+Alt+Down prev/next pane. Nothing else. |
| Harnesses | Claude Code, Pi/ADW, Grok. All must work on both surfaces. |
| Delivery | Four phases (§10). Phases 1–2 now; 3–4 only if missed after a week of use. |

## What is true in the code today (verified 2026-08-22)

Check again before each PR; line numbers drift.

- **No desktop breakpoints exist.** Zero `sm:`/`md:`/`lg:` utilities in `web/src`. Width is a
  per-route `max-w-screen-sm`. Tailwind v4, CSS-first — no `tailwind.config.*`; theme lives in
  `web/src/index.css`.
- **One layout.** `routes/root.tsx` renders banners → `<Outlet/>` → `<BottomNav/>` (gated on
  `showNav`). Each route mounts its own `<AppHeader/>`. The idle-lock cover is in `App.tsx`,
  outside the router; `useIdleLock()` is called there with no argument (`App.tsx:19`).
- **Display prefs** (`hooks/use-display-prefs.ts`) are a plain `useState` + localStorage
  (`collie:display-prefs:v5`), re-read on every mount. Two callers get two copies; `agent-chat.tsx`
  threads `prefs` into `Composer` on purpose. **This file is not touched by desktop mode.**
- **Haptics** (`lib/haptics.ts`) is the pattern for a tiny shared boolean: module value +
  `useSyncExternalStore` + a `__reset` test seam.
- **Right-click already opens the action sheets.** `hooks/use-long-press.ts` treats `contextmenu` as
  a trigger and `preventDefault()`s it. `fire()` calls `onLongPress()` with **no event**, so no
  pointer position reaches the sheet. Passing `onLongPress: undefined` disables **all** handlers
  including `contextmenu` — Android relies on the `contextmenu` path because a native
  `pointercancel` kills the hold timer.
- **Direct typing** (`hooks/use-direct-typing.ts`) already drives the composer's own `ChatInput`
  (`composer.tsx` ~946) and swaps `direct.value` in while the composer's `input` draft stays
  untouched. It refuses to arm when `replyDraft().length > 0` (policy check, ~line 114/230), disarms
  on pane change, page hidden, failed batch and `suspended`. `keyForKeyDown` reads only `event.key`;
  it never looks at `ctrlKey`/`altKey`/`metaKey`/`shiftKey`. A native `beforeinput` listener exists
  because React's synthetic one is unreliable. The wire format (`"ctrl+c"`, `"ctrl+shift+p"`,
  `"alt+Up"`, `"shift+Tab"`, `"cmd+…"`) and `composeKey` in `lib/key-queue.ts` already exist; the
  bridge (`bridge/pane-write-routes.ts` `keysPane`) passes any string array to Herdr. **The gap is one
  keydown handler.** The armed state is documented as "never persisted, never restored — don't lift
  it" (`CLAUDE.md` ~355-360 and the hook header).
- **Composer sends on Ctrl+Enter / Cmd+Enter.** Bare Enter inserts a newline (`composer.tsx` ~951-961).
  `onSendClick` runs `isDestructiveInput` for a two-tap confirm. `onPasteImage` handles image paste.
- **Keys pad** sends `ctrl+c` one-tap; only `ctrl+d` / `ctrl+z` confirm (`nav-tray.tsx`,
  `operator-keys.ts`). `DANGER_KEYS` = `ctrl+c`, `ctrl+d`, `ctrl+z`.
- **Prompt options** are sent by `lib/*-action.ts` through the dialog guard; `agent-chat.tsx` only
  derives a boolean from `buildBlocks`, the models live inside `AnsiOutput`. Plan dialogs end in a
  text row whose digit must never be sent as a button. Menu blocks never use digits (ADR 0009).
- **Find bar** (`components/find-bar.tsx`) handles Enter / Shift+Enter / Escape; opened only by a
  header button. The only global `keydown` listeners are the sheet's Escape (`ui/sheet.tsx`) and the
  idle-lock activity tracker.
- **`document.title` is never set.** `lib/triage.ts` has no count helper;
  `agents.filter(a => bucketOf(a) === "needs").length` is the number.
- `hooks/use-keyboard.ts` `useKeyboardOpen` has zero call sites (dead, mobile-only). Leave it.
- Pre-commit bump rule: any change under `web/src/` needs a version bump that sorts above HEAD,
  consistent across `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md`.

## Design

### 1. The switch

- New module `lib/desktop.ts`, copied from the `lib/haptics.ts` shape: localStorage key
  `collie:desktop:v1` → `{ on: boolean, typing: "composer" | "direct" }`, defaults
  `{ on: false, typing: "composer" }`, lazy-loaded on first read, `useSyncExternalStore`,
  `setDesktop(on)`, `setTyping(t)`, `__resetDesktop()` for tests. Exports `useDesktop()` →
  `{ on, typing }`. **`useDisplayPrefs` is not changed.**
- Settings route gets a `<Card>` row (same pattern as `haptics-control.tsx`): monitor icon,
  "Desktop mode", "Sidebar layout and direct keyboard typing. For a computer, not
  a phone.", `<Switch>`. Flipping it re-renders in place.
- When on, two more rows under it: **Typing surface** (Composer / Direct — see §3) and **Idle
  pause** (read-only text: "2 h on desktop. Pauses polling; it does not lock the shell — use your
  OS screen lock."). The haptics card is hidden when `on`.
- **Off-ramp banner.** When `on`, `DesktopShell` renders a one-line strip above the sidebar and
  pane: "Desktop mode is on · Turn off". It is always visible, never collapsible, so a phone user
  who flips the switch can get back without finding Settings in a 280 px sidebar on a 390 px screen.
- Components branch on `useDesktop().on`. No media query decides which controls exist.

### 2. Layout

```
+----------------+----------------------------------------------+
| Desktop mode is on · Turn off                                 |
+----------------+----------------------------------------------+
| [Collie] [sess]|  AppHeader: pane title · status · find/hist   |
|  ▾ space A     |----------------------------------------------|
|     ▾ tab      |                                              |
|        pane    |   mirror (AnsiOutput, prompt blocks inline)  |
|  ▸ space B     |                                              |
|                |----------------------------------------------|
|----------------|  statusline strip                             |
| Traces         |  [composer]  or  [Typing into terminal·Stop]  |
| Files          |                                              |
| Settings       |                                              |
+----------------+----------------------------------------------+
```

- `routes/root.tsx`: when `on`, render `<DesktopShell>` — a two-column grid, `aside` 280 px
  (fixed) + `main` (`<Outlet/>`). Banners stay above both. `BottomNav` is not rendered.
- **Sidebar** (`components/desktop-sidebar.tsx`): `<SpaceTree>` unchanged, session switcher at
  top, nav list (Spaces / Traces / Files / Settings, same gating props `BottomNav` uses) at the
  bottom. Current pane row highlighted.
- `main` drops `max-w-screen-sm` for the pane, history and files routes. The index route shows an
  empty state ("Pick a pane") because the tree is already in the sidebar.
- Pane view (`agent-chat.tsx`) keeps header, mirror, statusline, composer. Not rendered in desktop
  mode: the swipe-up handle and pane-switcher sheet, the `touch-none` strip, `PaneStrip`.
- Mirror width: the pane is **not** resized; `AnsiOutput` gets more room, fewer wrapped lines.
- Idle lock: `App.tsx` passes `on ? 2h : 30min` to `useIdleLock`.
- **Tab title**: in `RootLayout`, when `on`, `document.title = n > 0 ? \`(${n}) Collie\` : "Collie"`
  where `n` = agents with `bucketOf(a) === "needs"`. When `off`, the title is never touched. No
  `setAppBadge` (Chromium-installed-PWA only; deferred, §10).


### 2a. Scroll regions (added 2026-08-22, phase 2)

In desktop mode **only two things scroll: the pane mirror and the History transcript.** Everything
else is static and always on screen: the off-ramp strip, the sidebar (the space tree scrolls inside
its own box if it overflows), the pane `AppHeader`, the statusline strip, the composer / direct-typing
strip, and the prompt buttons. The page itself never scrolls (`body` / `#root` overflow hidden at
100 dvh). The mirror is a `min-h-0 flex-1 overflow-y-auto` box between the fixed header and the
fixed bottom controls; History is the same shape with the transcript as the scrolling child. The
phone keeps whatever it does today — this applies only when `on`.

### 3. Typing

`typing` picks which surface is shown under the mirror. **Armed state stays exactly what it is
today**: session-local, false on every pane mount, cleared on pane change / page hidden / failed
batch / `suspended`. Choosing `typing: "direct"` does not arm anything by itself.

**Composer surface** (default):
- **Enter sends, Shift+Enter inserts a newline** — the one change to the `onKeyDown` branch in
  `composer.tsx`, gated on `on`, and only when `!e.nativeEvent.isComposing` (IME commit also uses
  Enter). Ctrl+Enter still sends.
- Esc, Tab and arrows pass through to the pane when the box is **empty**. **Ctrl+C does not** —
  an empty box is exactly the state after Enter-sends, and a reflexive copy must not SIGINT the
  agent. Ctrl chords are direct-surface only (or the pad on the phone).
- Send keeps `isDestructiveInput` two-tap confirm.

**Direct surface:**
- Uses the **existing composer textarea** and the existing `useDirectTyping` hook. No second
  textarea, no second key queue. `DirectTypingStrip` ("Typing into terminal — Stop") renders where
  the input row was; the input is visually hidden behind it but keeps focus.
- **Arm**: click the mirror (`focusFromMirror` → `composerRef.focusInput()` + `direct.activate()`)
  or press Ctrl+`. Arming is refused if the click ends with a non-collapsed `window.getSelection()`
  — the user was selecting text, not asking to type. The `replyDraft().length > 0` refusal is
  **bypassed only in the `on` branch** of `activate()` (not removed): the composer's `input` draft
  is untouched while armed, so nothing to restore.
- **Armed = focused.** Ring on the mirror and the strip both follow the textarea's own
  `focus`/`blur`. Release on: the Stop button, Ctrl+`, any `pointerdown` outside the mirror
  (sidebar, header, find bar, a prompt button, a popover), and `window.blur`. The idle-pause cover
  blurs it (assert this in a test). **No Esc-Esc.**
- **Keydown mapper** replaces `keyForKeyDown` when `on`:
  - `event.isComposing || keyCode === 229` → do nothing (let the IME finish).
  - AltGr: `ctrlKey && altKey` or `getModifierState("AltGraph")` → treat as **no modifier**, fall
    through to the input path so `@ { | ~` on non-US layouts type normally.
  - printable, no modifier → existing input/change path.
  - `Enter`, `Backspace`, `Tab`, `Escape`, arrows, `F1`–`F12`, `" "` → `Space` → named key.
  - Ctrl / Alt / Meta held → `composeKey(mods, base)` where `base` = named key, or the
    **lower-cased** `event.key` for a single char, and `shift` is added from `event.shiftKey`
    explicitly (`ctrl+shift+p`, `ctrl+Space`, `ctrl+[`, `shift+Tab`). Meta → `cmd`.
  - `preventDefault()` on every key we send; never on keys we don't.
  - **Kept by the browser even when captured** (not sent): Ctrl+C **with a selection in the
    mirror** (copy; Ctrl+Shift+C is not special-cased), Ctrl+R / Ctrl+Shift+R / F5 (reload), and the
    global chords in §6. Chords the browser never delivers (Ctrl+T, Ctrl+W, Ctrl+N, Ctrl+Shift+N,
    Ctrl+Tab, Ctrl+Shift+T, Alt+Left/Right, F11) are listed in the README.
  - Keys Herdr rejects (`Home`, `End`, `PageUp`, `PageDown`, `Insert`, `Delete`) are **not sent**; a
    status line says "Herdr can't send Delete". No silent look-alikes.
  - Firefox on Windows toggles its menu bar on a bare Alt release: `preventDefault()` bare `Alt`
    keydown and keyup while captured.
- Ctrl+C (no selection), Ctrl+D, Ctrl+Z send **immediately** with no confirm — a terminal is a
  terminal. Ctrl+D shows a status so a closed shell isn't a surprise.
- **Paste** while captured: single-line text with no newline and not `isDestructiveInput` → sent
  via `textToKeySequence` as today. Otherwise the text is held in the strip: "Paste 5 lines into the
  terminal? Send · Discard". Send keeps the newlines as `Enter` keys and never appends a trailing
  Enter. Image paste → `onPasteImage` (exists); the returned host path shows in the strip as a
  one-click "Type path" chip, never typed unprompted.
- `readOnly` device or `gone` pane: strip greyed with the reason; no capture.
- Prompt blocks stay rendered and clickable on both surfaces. While captured, digits go to the pane
  raw — that is what "direct" means.

Unit tests for the mapper cover every bullet above as a table: plain char, Enter, Backspace, Tab,
Shift+Tab, Ctrl+C with/without selection, Ctrl+Shift+P, Ctrl+Space, Ctrl+[, AltGr+Q, Enter while
composing, F5, Delete, Alt keyup, paste single-line, paste multi-line, paste `rm -rf`.

### 4. Mouse (phase 3)

- `useLongPress` gains `disabled` (skips **only** the pointerdown hold timer; `onContextMenu` still
  `preventDefault`s and fires) and passes `{ x, y }` from the triggering event to `onLongPress`.
  Callers pass `disabled: on` — nothing else, never pointer type or viewport.
- When `on`, the three `*ActionsSheet` components render their **same rows**
  (`action-sheet-rows.tsx`) inside a popover anchored at `{x,y}`; anchor falls back to the row's
  `getBoundingClientRect()` when `x`/`y` are 0 (keyboard Menu key, Shift+F10). Not a new component
  family — same body, different container.
- Rename inline (existing `RenameView`; Enter saves, Esc cancels). Close stays two-step.
- Record the desktop exception to the "no second gesture / no second sheet" rule in `CLAUDE.md`.
- **No hover `…` button.**

### 5. Phone-only features

| Feature | Desktop mode |
|---|---|
| Keys pad (`NavTray`, "Keys" control) | Not rendered; control removed from the Controls row. |
| "Type" control | Removed; Ctrl+` and the Settings row replace it. |
| Haptics card | Hidden when `on`. |
| Attach-image button | Hidden. Paste works (exists). Drag-and-drop is phase 3. |
| Swipe-up pane switcher, `PaneStrip` | Not rendered. |
| `tapToFocus` pref row | Hidden (click-to-focus is the arm). |
| Bottom nav | Not rendered. |
| Push, PWA install, pull-to-refresh | Untouched. |

### 6. Hotkeys (phases 1–2)

One `useDesktopHotkeys()` in `DesktopShell`, a single `window` `keydown` listener in **capture**
phase (before the sheet's Escape listener). Never swallow a chord we don't own.

| Chord | Action | Notes |
|---|---|---|
| Ctrl+` | Arm / release direct capture | Global; no browser or common TUI owns it. Also switches `typing` to `direct` if it was `composer`. |
| Ctrl+F | Open Collie find bar (pane, history) | **Only when not captured** — Ctrl+F is vim/less/readline in the pane. Esc closes; Enter / Shift+Enter next / prev (exists). Not intercepted on tree/settings. |
| Ctrl+Alt+Up / Ctrl+Alt+Down | Previous / next pane, "needs you" first | Global. Order = `triage(agents)` flattened, tree order within a section. Not a browser chord; AltGr+arrow is not a glyph so the AltGr rule doesn't collide. |

While captured, **only Ctrl+` and Ctrl+Alt+Up/Down** are global; everything else goes to the pane.
Not planned: Ctrl+B, Ctrl+K palette, F2 rename, close-pane chord.

### 7. History and Files (phase 4)

- History: drop `max-w-screen-sm`; `TranscriptView` in a centred `max-w-3xl` column. Ctrl+F works.
- Files: drop `max-w-screen-sm`. Two-column list + preview is **deferred**.

### 8. Out of scope

- Resizing the real pane. No `bridge/` changes at all.
- Split / multiple panes. Auto-detect. Resizable or collapsible sidebar. `setAppBadge`. Dynamic
  favicon. Ctrl+K palette. Hover affordances. Windows/POSIX Herdr action parity.

### 9. Phone unchanged — acceptance test

- All existing tests pass **unchanged** (`bun run test` at root and in `web/`; record the exact
  counts at baseline). No existing test file is edited — `useDisplayPrefs` is untouched.
- New tests, with `on: false`: the tree contains `BottomNav`, the Keys and Type controls, the attach
  button, the swipe handle; it does **not** contain `DesktopShell`, the sidebar, the banner or the
  hotkey listener; `document.title` is untouched; `useLongPress` with `disabled: false` still opens
  the sheet on a `contextmenu` event and the event is `defaultPrevented`; arming with a non-empty
  `replyDraft` still refuses with the existing status message; Enter in the composer inserts a
  newline.
- Snapshot `lib/desktop.ts` defaults: `{ on: false, typing: "composer" }`.
- Manual: open the PWA on the phone after the build; nothing looks or behaves differently.

### 10. Phases

Each phase is one branch → push → `gh pr create` → operator merges. One CHANGELOG line per phase.
Build phases 1 and 2 now; 3 and 4 only if they are missed after a week of real use.

| Phase | Branch | Version | Contents | Done means |
|---|---|---|---|---|
| 1 Shell | `feat/desktop-shell` | **0.56.0** | `lib/desktop.ts`; Settings card + off-ramp banner; `DesktopShell` + sidebar; bottom nav / swipe / `PaneStrip` / attach / Keys / Type / haptics / tapToFocus hidden when on; idle 2 h; tab title; Ctrl+Alt+Up/Down; §9 tests. | Toggle on → sidebar layout; off → identical to today. Both suites green; no existing test file edited. |
| 2 Typing | `feat/desktop-typing` | **0.56.1** | Enter-sends + empty-box pass-through; Ctrl+` arm/release; focus-driven armed state + outside-click/blur release; keydown mapper + test table; selection-aware Ctrl+C; paste hold; Herdr-unsupported notice; draft bypass in the `on` branch; amend CLAUDE.md / hook comment (surface pref is stored, armed state is not); Ctrl+F; `NEXT-SESSION.md`; tag `v0.56.1`. | Manual checklist in the PR body: Claude AskUserQuestion, permission prompt, Pi ADW run, Grok pane, bare shell, vim in a shell, non-US layout AltGr. |
| 3 Mouse | `feat/desktop-mouse` | 0.56.2 | Right-click popover + `useLongPress` `disabled` / `{x,y}` (§4); drag-and-drop upload (window-level `dragover`/`drop` `preventDefault`, files only, "Type path" chip); CLAUDE.md exception note. | Right-click opens the same rows at the pointer; Android long-press test still passes; a stray drop never navigates. |
| 4 Views | `feat/desktop-views` | 0.56.3 | Number keys pick prompt options (memoise `blocks` in `agent-chat`, pass `promptBlock` to `Composer`, digit → `prompt.options.find(o => o.keys[0] === n)` → `handlePromptAction`, no-op + status on any other dialog); History/Files drop `max-w-screen-sm`; README "Desktop mode" section incl. "keys the browser keeps"; tag. | Digit never reaches a plan/wizard row raw; README doc-links check passes. |

## Council decisions folded in (2026-08-22)

Adopted: selection-aware Ctrl+C and no Ctrl+C pass-through from the composer; paste hold for
multi-line / destructive text; one textarea, no overlay; no Esc-Esc; mode chord moved off
Ctrl+Shift+T and Ctrl+B/Ctrl+F no longer stolen while captured; Shift/AltGr/IME mapper rules; armed
state stays session-local; own tiny store instead of a `useDisplayPrefs` refactor; title gated on
desktop, badge dropped; `useLongPress` `disabled` semantics and `{x,y}`; drag-drop hardened and
deferred; digits deferred and routed through the guard; delivery cut to two phases now, two later; off-ramp banner.
Removed: hover `…` button.
