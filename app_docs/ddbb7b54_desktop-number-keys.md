# Desktop Mode Prompt Option Number Keys (0.56.13)

## Overview

This change implements desktop mode number-key prompt picking for the Composer surface (`specs/desktop-mode-spec.md` §10 Phase 4 / `specs/ddbb7b54_desktop-number-keys.md`). When desktop mode is active and a recognised prompt dialog is on screen, pressing a digit key in an empty composer input routes the selection through the existing guarded prompt action handler (`submitPromptOption`) rather than sending raw terminal keystrokes or typing into the text box.

Non-prompt dialogs, focused plan feedback rows, or unmatched digits are safely intercepted and surface non-persistent warning status notices ("Use the buttons for this dialog", "No option N") without leaking characters to the terminal or composer.

## Changed Files

- `web/src/components/agent-chat.tsx`:
  - Memoises parsed block array (`blocks`) from terminal ANSI output when grammars are enabled.
  - Derives `currentDialog` by finding the latest non-raw block from the end of `blocks`, deriving `dialogPresent` and `promptBlock` (`PromptSelectBlock`).
  - Passes `promptBlock` and `onPromptAction={handlePromptAction}` down to `<Composer />`.
- `web/src/components/composer.tsx`:
  - Extends `ComposerProps` with optional `promptBlock?: PromptSelectBlock` and `onPromptAction?: (action: PromptBlockAction, prompt: PromptSelectBlock["prompt"]) => Promise<boolean>`.
  - In `ChatInput`'s `onKeyDown` handler (when direct typing is inactive, no modifiers are pressed, and input is empty), intercepts single digits (`/^[0-9]$/`):
    - If `!dialogPresent`, passes through to normal typing.
    - Prevents default event behavior to avoid typing digits into the box.
    - If a valid `promptBlock` and `onPromptAction` exist:
      - If `promptBlock.prompt.feedback?.focused` is true, displays `"Use the buttons for this dialog"` warning status.
      - Finds option matching `o.keys[0] === e.key`; if found, triggers `onPromptAction({ kind: "option", option }, promptBlock.prompt)`; otherwise sets `"No option <key>"` warning.
    - If a non-prompt dialog is present without a prompt block, displays `"Use the buttons for this dialog"` warning status.
- `web/src/components/composer-prompt-keys.test.tsx` (new):
  - Unit tests for composer number-key handling in desktop mode:
    - Routing matching digits to `onPromptAction` with zero raw key sends over `/api/pane/:id/keys`.
    - Handling unmatched digits with `"No option <key>"` status.
    - Blocking input on plan dialog text rows and focused feedback rows with appropriate warning notices.
    - Blocking input on non-prompt dialogs (`promptBlock: undefined`).
    - Verifying passthrough when direct typing is armed, when no dialog is present, when the input box is non-empty, and when desktop mode is disabled (`on: false`).
- `web/src/components/agent-chat-prompt-keys.test.tsx` (new):
  - Component integration tests verifying `AgentChat` derives `promptBlock` from screen text and delegates to `submitPromptOption` with correct option payload and detected revision.
  - Tests warning on unmatched options and wizard dialog isolation.
- `README.md`:
  - Updated the "Desktop mode" section to document number-key prompt picking behavior in Composer mode.
- `specs/ddbb7b54_desktop-number-keys.md` (new):
  - Specification and execution plan for desktop mode phase 4 prompt number-key picking.
- `herdr-plugin.toml`, `package.json`, `web/package.json`:
  - Bumped version from `0.56.12` to `0.56.13`.
- `CHANGELOG.md`:
  - Added entry under `## [0.56.13] - 2026-08-23` → `### Added`: "Desktop mode: number keys pick prompt options through the dialog guard".

## Verification

Run the test suites, link check, and version consistency verification:

```bash
bash scripts/check-version.sh
bash scripts/check-doc-links.sh
bun run typecheck
cd web && bun run test
bun run test
```
