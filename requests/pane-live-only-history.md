Remove the live/stitched history mix from the pane. The pane shows only the live terminal viewport. Keep the History button; it still opens today's parsed conversation at `/pane/:paneId/history` and that page must keep up to date as the session progresses.

Where: `web/src/components/agent-chat.tsx` (inline transcript above the live tail, seam trim, collapsed live tail, History button at ~line 722), `web/src/components/agent-chat.test.tsx` (inline-history / collapsed-tail / history-affordance tests), `web/src/hooks/use-inline-history.ts` and `use-inline-history.test.ts`, `web/src/lib/transcript-seam.ts` and `transcript-seam.test.ts`, `web/src/router.tsx` (`shouldRevalidate: () => false` on `pane/:paneId/history`), `web/src/lib/loaders.ts` (`historyLoader`, `HISTORY_PAGE_SIZE`), `web/src/routes/history.tsx` (parsed conversation; loader is frozen so new turns never appear until you leave and re-enter), `web/src/components/transcript-view.tsx` (keep).

Done means:
- Opening a pane shows only the live CLI viewport. No journal turns stacked above the tail, no Live seam, no hiding the TUI when idle. Swiping up on an agent pane does not page transcript turns into the pane.
- The Conversation history button stays in the pane header when the pane has a session (`hasSession`) and still navigates to `/pane/:paneId/history`.
- History is still the parsed conversation: markdown turns, tool cards, find-in-history, jump-to-user-turn. It is not a raw text dump.
- While History is open, new turns the agent writes appear without leaving and coming back. A `/clear` or session swap is reflected. Do not yank a reader who has scrolled up; keep their place when new turns append.
- `use-inline-history` and `transcript-seam` (and their tests) are gone if nothing else imports them. Tests that asserted the stitch/collapsed-tail mix are removed or rewritten to assert live-only. History-affordance tests still pass.
- `cd web && bun run test` passes and `bun run build` succeeds.
- Version bump in `herdr-plugin.toml`, `package.json`, `web/package.json` plus a `CHANGELOG.md` entry, as `CLAUDE.md` requires for any `web/src/` change. Axis is what the operator sees: swipe-up-on-pane no longer reads the conversation; History is the one place that does, and it now stays current.

Out of scope: `bridge/journal/` adapters, `/api/pane/:id/history` contract, turning History into raw CLI text, find-in-output on the live pane, display-prefs / `rawTerminal` grammars, shell "Load older" scrollback, traces, composer, settings.
