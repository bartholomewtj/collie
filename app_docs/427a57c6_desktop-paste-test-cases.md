# Desktop Mode Paste Hold and Find Request Test Coverage (0.56.8)

## Overview

This change adds missing unit test coverage for edge cases across desktop mode paste hold handling and find requests, closing reviewer findings on commit `0260861` without modifying any product code. It also applies a patch version bump to `0.56.8`.

## Changed Files

- `web/src/hooks/use-direct-typing-paste.test.tsx`:
  - Imported `textToKeySequence` from `@/lib/key-queue`.
  - Added test case verifying trailing-newline commands (`"echo hi\n"`) hold as a single line (`lines: 1`) and emit key sequences without an `"Enter"` key on send.
  - Added test case asserting destructive commands (`"rm -rf /tmp/x"`) hold with a matching destructive reason (`/rm -r/`) and do not send immediately.
  - Added test case verifying image paste creates a `"path"` hold that only types the uploaded file path (`textToKeySequence("/host/shot.png")`) after `onSend` is triggered.
  - Added test case confirming phone mode (`desktop: false`) ignores multiline paste (`"a\nb"`), leaving the hold store `null` and sending no keys.
- `web/src/components/direct-typing-strip-paste.test.tsx`:
  - Added test case verifying `pointerdown` on the Send button has its default prevented (`defaultPrevented === true`) so focus remains within the active textarea.
- `web/src/lib/find-request.test.ts`:
  - Added test case verifying `requestFindOpen()` does not throw when called with no registered subscribers.
- `web/src/lib/paste-hold.test.ts`:
  - Added test case asserting `__resetPasteHold()` returns the store state to `null`.
- `specs/427a57c6_desktop-paste-test-cases.md`:
  - Specification and task plan for closing reviewer test coverage findings.
- `herdr-plugin.toml`, `package.json`, `web/package.json`:
  - Bumped version from `0.56.7` to `0.56.8`.
- `CHANGELOG.md`:
  - Added entry for `## [0.56.8] - 2026-08-22` under `### Changed` documenting desktop mode test coverage for paste hold and find request edge cases.

## Verification

Run test suites and version consistency checks:

```bash
cd web && bun run test
bun run test
bun run typecheck
bash scripts/check-version.sh
```
