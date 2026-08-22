# Desktop Mode Keydown Mapper and 0.56.6 Release

## Overview

This change implements desktop mode keydown mapping for direct typing (`specs/desktop-mode-spec.md` §3 "Keydown mapper"), enabling keyboard chords (Ctrl, Alt, Shift, Cmd) and function keys to be sent directly to Herdr panes while preserving browser-reserved reflexes and handling layout specifics like AltGr.

When `useDesktop().on` is active and direct typing is armed, keydown events are processed by a pure mapper with strict precedence rules, ensuring wire keys are correctly formatted, browser actions (reload, copy with selection, IME composition) remain unblocked, and unsupported keys trigger informative status notices.

## Changed Files

- `web/src/lib/desktop-keymap.ts` (new):
  - Pure keydown mapper (`mapKeyDown`) and event handler (`handleDesktopKeyDown`) implementing precedence rules:
    - IME composition (`isComposing || keyCode === 229`) is ignored so text entry finishes normally.
    - Global Collie chords (`Ctrl+\``, `Ctrl+Alt+ArrowUp/Down`) pass through to global window handlers.
    - Reload shortcuts (`F5`, `Ctrl+R`, `Ctrl+Shift+R`) pass through to the browser.
    - Copy reflex (`Ctrl+C` or `Cmd+C` with active text selection) is ignored to permit clipboard copy.
    - `AltGr` (`ctrlKey && altKey` or `getModifierState("AltGraph")`) suppresses modifier state to allow typing special characters (`@`, `\`, `~`).
    - Bare `Alt` keydown is swallowed (`defaultPrevented` without sending); bare modifier keys (`Control`, `Shift`, `Meta`) are ignored.
    - Unsupported keys (`Home`, `End`, `PageUp`, `PageDown`, `Insert`, `Delete`, and modified `+`) are ignored with a warning notice (`"Herdr can't send <key>"`).
    - Unmodified printable characters and digits pass through to the standard input/change path.
    - Modified keys and named keys (`Enter`, `Backspace`, `Tab`, `Escape`, arrows, `F1`–`F12`, `Space`) are composed via `composeKey(mods, base)` with `cmd+` prefix for `metaKey`.
    - `Ctrl+C` (without selection), `Ctrl+D`, and `Ctrl+Z` send immediately; `Ctrl+D` displays an informational status note (`"Sent Ctrl+D — this can close the shell."`).
  - Calls `event.preventDefault()` strictly on `"send"` and `"swallow"` actions (never on `"ignore"`).
  - Exports `isAltKeyUp` to detect bare Alt key releases.
- `web/src/hooks/use-direct-typing.ts`:
  - Branches `onKeyDown` when `desktop` is true to process events through `handleDesktopKeyDown`, surfacing notices via `setStatus` and enqueuing keys via `sender.enqueue()`.
  - Added a native `keyup` event listener effect when `desktop && active` to prevent default on bare Alt releases (preventing Windows/browser menu bar activation).
- `web/src/lib/desktop-keymap.test.tsx` (new):
  - Table-driven unit tests verifying mapping, exact wire string outputs (`"ctrl+shift+p"`, `"ctrl+Space"`, `"cmd+k"`, etc.), and `defaultPrevented` states across all supported and ignored key combinations.
  - Unit test for `isAltKeyUp`.
  - Probe component test confirming phone mode direct typing remains unaffected by desktop mapper logic.
- `specs/0c71c0ee_desktop-keydown-mapper.md` (new):
  - Phase 2 chunk 3 plan and specification detailing mapper requirements, precedence rules, and verification.
- `herdr-plugin.toml`, `package.json`, `web/package.json`:
  - Bumped version from `0.56.5` to `0.56.6`.
- `CHANGELOG.md`:
  - Added release notes for version `[0.56.6]` under `Added`.

## Verification

Run the test suite and version checks:

```bash
bash scripts/check-version.sh
bun run typecheck
cd web && bun run test
bun test
```
