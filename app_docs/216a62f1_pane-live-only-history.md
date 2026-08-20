# Live-Terminal-Only Pane and Real-Time History Page

## What Changed

The pane view now strictly renders the live CLI viewport. The inline transcript stacked above the live tail, the "Live" divider seam, transcript seam-trimming logic, and swipe-up transcript pagination have been removed from the pane view.

The "Conversation history" button in the pane header remains intact for agent sessions (`hasSession`) and still navigates to `/pane/:paneId/history`.

The dedicated History view (`/pane/:paneId/history`) is now the single place to read parsed conversation logs (markdown messages, tool cards, find-in-history, jump-to-user-turn). While open, History now stays live and current as the agent runs:
- Status transitions (and a 30s interval while working, plus a 2s post-run retry) poll the newest page of history (`/api/pane/:id/history`) and splice in fresh turns using `mergeNewest`.
- Scrolled-up readers do not lose their place or get jerked to the bottom: `renderCount` adjusts when turns are appended, and auto-scroll to the bottom occurs only if `following` (when the reader is already at the bottom).
- Session swaps or `/clear` resets (where no turns overlap) cleanly replace the transcript and reset scroll.

## Files Touched

- `web/src/components/agent-chat.tsx`: Removed `useInlineHistory`, `TranscriptView`, and `transcript-seam` usage; pane view now displays only the live terminal output mirror with load-older scrollback for shells. History header button is preserved.
- `web/src/components/agent-chat.test.tsx`: Removed inline-history and collapsed live-tail tests; updated top-of-mirror history affordance tests to assert live-only CLI viewport behavior.
- `web/src/hooks/use-inline-history.ts` & `web/src/hooks/use-inline-history.test.ts`: Deleted.
- `web/src/lib/transcript-seam.ts` & `web/src/lib/transcript-seam.test.ts`: Deleted.
- `web/src/router.tsx`: Updated `historyRoute` comment explaining why `shouldRevalidate` is false and how in-view polling handles freshness.
- `web/src/routes/history.tsx`: Added real-time polling logic (`refreshNewest`, `mergeNewest`), status transition triggers, `following` state tracking via `ChatMessageList.onAtBottomChange`, and anchor adjustment when new turns arrive.
- `herdr-plugin.toml`, `package.json`, `web/package.json`: Bumped version from `0.46.2` to `0.47.0`.
- `CHANGELOG.md`: Added release notes for `0.47.0`.

## Verification

1. Run frontend test suite:
   ```bash
   cd web && bun run test
   ```
2. Build the project and typecheck:
   ```bash
   bun run build
   ```
3. Check version agreement across all files:
   ```bash
   bash scripts/check-version.sh
   ```
