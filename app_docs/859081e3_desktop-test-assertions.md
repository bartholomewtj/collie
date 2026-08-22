# Desktop Mode Test Assertions and 0.56.5 Release

## Overview

This change completes test assertion coverage for desktop mode keyboard handling and direct-typing arm/release behaviors across three frontend test suites, closing reviewer findings without modifying any product code. It also applies a patch version bump to 0.56.5.

## Changed Files

- `web/src/components/composer-desktop.test.tsx`: Added `replyHandler` helper to mock `/api/pane/:id/reply`. Completed assertions for:
  - Phone mode (`setDesktop(false)`): Enter key inserts a newline without sending a reply and is not default-prevented.
  - Desktop mode (`setDesktop(true)`): Enter key sends typed text, triggers submission, clears the input, and is default-prevented; Shift+Enter inserts a newline without sending.
  - Chords & composition: Ctrl+Enter sends replies; Enter while composing (`isComposing: true`) is ignored without sending.
  - Key passthrough & destructive sends: non-empty input prevents key passthrough to `/api/pane/:id/keys`; destructive commands require two-tap confirmation before sending.
- `web/src/components/agent-chat-arm.test.tsx`: Expanded gone-pane test (`shows locked strip for gone pane and cannot arm`) to verify that the strip displays the gone reason, no "Stop" button renders, and clicking the output region does not arm the session or apply the active `ring-2` class.
- `web/src/hooks/use-direct-typing-desktop.test.tsx`: Replaced placeholder element with a functional `StatusSentinel` reading from `useStatus()`, added `clearStatus()` cleanup in `beforeEach`, and verified the exact refusal status message (`"Send or clear the draft before typing into the terminal."`) when attempting to arm phone direct-typing with an active draft.
- `specs/859081e3_desktop-test-assertions.md`: Plan specification for resolving test assertion gaps.
- `herdr-plugin.toml`, `package.json`, `web/package.json`: Bumped version from `0.56.4` to `0.56.5`.
- `CHANGELOG.md`: Added entry under `## [0.56.5] - 2026-08-22` documenting test coverage additions for desktop mode.

## Verification

Run the test suite and version checks:

```bash
bash scripts/check-version.sh
bun run typecheck
cd web && bun run test
bun run test
```
