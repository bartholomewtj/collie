# Plan — live-only pane; History becomes the one (and live) transcript surface

Adw id: `216a62f1` · Repo: `C:/claudeOS/Projects/tools/collie` · Version: 0.46.2 → **0.47.0** (MINOR)

## What changes, in one paragraph

The pane view (`AgentChat`) currently stitches the parsed journal transcript above the live terminal
tail (seam-trimmed, with the tail hidden when "caught up"). All of that goes away: the pane shows
only the live CLI viewport, always. The header's Conversation-history button stays (still gated on
`agent.hasSession`, still navigates to `/pane/:paneId/history`). The History page keeps its parsed
conversation (markdown turns, tool cards, find, jump-to-user-turn) but stops being a frozen
snapshot: it refreshes its newest turns in place as the session progresses, without yanking a
reader who has scrolled up, and reflects `/clear` / session swaps.

## Files to change

### 1. `web/src/components/agent-chat.tsx` — strip the inline transcript

Remove entirely:

- Imports: `useInlineHistory, INLINE_GROW_THRESHOLD` (`@/hooks/use-inline-history`),
  `TranscriptView` (`@/components/transcript-view`), and
  `commandsOnlyTurn, liveMirrorNeeded, newestTurnInViewport, trimAtSeam` (`@/lib/transcript-seam`).
- The `getScrollElement` callback and the `const inline = useInlineHistory({...})` call (~line 271).
- The seam machinery: `mirrorPlain`, `caughtUp`, `commandsOnly`, `livePinned` / `pinnedFor` state,
  `showLive`, `visibleEntries` (~lines 285–320).
- The scroll listener that pages transcript turns on swipe-up (`INLINE_GROW_THRESHOLD` /
  `inline.growUpward()`, ~line 368).
- The `useLayoutEffect` "Prefetch inserts turns above the live tail" (~line 383).
- In `onSent`: the `/clear` → `inline.reset()` branch (keep `setFollowing(true)` +
  `revalidate()` + `scrollToBottom()`).
- In the JSX: the whole `{visibleEntries.length > 0 && (...)}` block — the loading spinner,
  `<TranscriptView>`, the "Live" divider, and the Show live / Hide live buttons (~lines 770–830).

Adjust:

- `historyAvailable` is deleted (its only remaining consumer is gone); the header History button
  already gates on `agent.hasSession` directly — keep that.
- The shell "Load older" button's condition simplifies from `!historyAvailable && moreScrollback`
  to just `moreScrollback`. (An agent pane on the alternate screen has `readableLines` ≈ viewport,
  so this changes nothing there; a primary-screen pane with a real ring now gets Load older, which
  is correct — the transcript no longer claims that pane.)
- The mirror renders unconditionally now:
  `{display ? <AnsiOutput … /> : <div className="py-16 …">(no recent output)</div>}`.
- Update the now-stale comments: the top-of-file "chat thread with a live terminal tail" shell
  comment (the pane is now a live terminal view with a composer), the rightLead History comment
  (drop "The last turns now also sit above the live tail…"), and the "What the top of the buffer
  can offer" comment (only scrollback remains).

Keep untouched: freeze/find logic, statusline strip, all dialog handlers, the pane-switcher swipe
handle (`useSwipeUp` on the composer handle — that gesture switches panes, it is NOT the transcript
paging), the mount-time `scrollToBottom`, the History button itself.

### 2. Delete dead modules (grep confirms no other importers)

- `web/src/hooks/use-inline-history.ts`
- `web/src/hooks/use-inline-history.test.ts`
- `web/src/lib/transcript-seam.ts`
- `web/src/lib/transcript-seam.test.ts`

Before deleting, re-grep `use-inline-history|transcript-seam|liveMirrorNeeded|trimAtSeam|mergeNewest`
across `web/` to confirm only `agent-chat.tsx` + the two test files reference them.

`web/src/components/transcript-view.tsx` stays — History renders it.

### 3. `web/src/routes/history.tsx` — keep the page current

The route keeps `shouldRevalidate: () => false` in `router.tsx` (the 5000-turn gulp must not run on
the 1.5 s poll). Freshness comes from an in-view newest-page refresh, ported from the deleted
`use-inline-history` logic:

- Add state: `tail` (initialised to `data.entries`) and `total` (initialised to `data.total`).
  `entries` becomes `[...older, ...tail]` (currently `[...older, ...data.entries]`).
- Move the pure `mergeNewest(prev, fresh)` splice (uuid-keyed: overlap replaces + appends; **no
  overlap means a different session → wholesale replacement**) into `history.tsx`, exported so
  tests can pin it. Keep its doc comment.
- Refresh trigger: the ROOT loader still revalidates on the poll while History is open, and the
  page already reads `useRouteLoaderData(ROOT_ROUTE_ID)` — so `agent?.status` is live here. Port
  the trigger shape from `use-inline-history`: fetch the newest page
  (`fetchHistory(paneId, { limit: 80 }, session)` — define a local `HISTORY_TAIL_PAGE = 80`) on
  every status transition, plus a 2 s retry after working → idle/done, plus a 30 s interval while
  status is `working`. Skip while an older-page load is in flight.
- Applying a refresh:
  - Overlap (normal case): `setTail(prev => mergeNewest(prev, fresh))`; `older` untouched;
    `total = fresh.total`; `hasMore` only replaced when the merge was a wholesale replacement.
  - No overlap (session swap / `/clear`): replace `tail` with `fresh.entries`, **clear `older`**,
    reset `renderCount` to `INITIAL_RENDER`, adopt `fresh.hasMore` / `fresh.total`, and scroll to
    bottom (it is a new conversation).
  - `available: false` mid-rotation: keep what's on screen (same as the inline hook did).
- Reader preservation:
  - Track at-bottom via `onAtBottomChange` on `ChatMessageList` (the pane already uses this prop).
  - Appending while at bottom → `scrollToBottom()` in an effect keyed on the appended count.
  - Appending while scrolled up → grow `renderCount` by the number of appended turns, so the
    window's start index (and therefore the reader's content and DOM nodes) is unchanged — new
    turns paint below the viewport, scroll untouched. The content-anchoring invariant is the same
    one `loadOlder` already maintains, mirrored.
- The `shown.length / data.total` counter in the header reads the `total` state.
- Update the header comment: the loader stays frozen on purpose; freshness is the in-view refresh.

### 4. `web/src/router.tsx`

No behavioural change — keep `shouldRevalidate: () => false` on `pane/:paneId/history`. Rewrite its
comment to say freshness is handled in-view (status-driven newest-page refresh), not by
revalidation.

### 5. `web/src/components/agent-chat.test.tsx`

- Delete the whole `describe("AgentChat — collapsed live tail")` block (Show live / Hide live /
  Live-seam / hide-when-caught-up assertions — all of that behaviour is gone).
- Rewrite `describe("AgentChat — top-of-mirror history affordance")`:
  - Agent pane with a session (`hasSession: true`): the mirror text renders; **no** transcript
    turns appear (`queryByText("what changed today?")` is null — the default MSW handler serves
    them, so this also proves the pane no longer fetches inline history); no "Live" divider; no
    Show/Hide live button; the header History button is present.
  - Shell Load-older cases stay as they are (`moreScrollback` gating is unchanged for shells).
  - "a transcript wins even when the pane also reports scrollback" → invert: a pane with real
    scrollback (`readableLines: 6946`, `requestedLines: 600`) gets Load older whether or not it
    reports a session.
  - "keeps the header History button": keep the button assertion, drop the inline-transcript one.
- `describe("AgentChat — history affordance")` (offered / hidden / left of the status pill) passes
  unchanged — leave it alone.
- Everything else in the file is untouched (reply flow, race guard, raw terminal, tap-to-type,
  block-grammar scoping, traces).

### 6. New `web/src/routes/history.test.tsx`

Pragmatic coverage (jsdom has no real scroll metrics — assert data/DOM, not scrollTop):

- Unit-pin `mergeNewest`: overlap splices (replacing a tool call that picked up its result),
  no-overlap replaces wholesale.
- Mount `HistoryRoute` inside `createMemoryRouter` with a stub ROOT route whose loader serves the
  fixture snapshot (so `useRouteLoaderData(ROOT_ROUTE_ID)` resolves), MSW serving the fixture
  transcript. Then flip the handler to return the transcript plus a new turn and advance the
  trigger (either re-run the root loader via `router.revalidate()` after mutating the agent's
  status in the handler, or drive the 30 s working interval with `vi.useFakeTimers()`):
  - the new turn appears in the DOM without any navigation;
  - a response with zero uuid overlap replaces the whole transcript (old turns gone, new ones
    shown).

## Version + changelog (CLAUDE.md contract — `web/src/` changed)

- Bump **0.46.2 → 0.47.0** in all three: `herdr-plugin.toml`, `package.json`, `web/package.json`.
  MINOR, following the repo's own precedent for removed/reworked surfaces (0.35.0, 0.40.8): the
  operator's surface changes — swipe-up-on-pane no longer reads the conversation; History is the
  one place that does, and it now stays current — but no setup breaks.
- `CHANGELOG.md`: new `## [0.47.0] - <real date>` heading, `### Changed` section, one crisp line
  per change, citing the feature commit's short hash (land the functional commits first, then cut
  the release commit — per CLAUDE.md). Suggested lines:
  - Pane view is live-terminal-only: the stitched transcript above the tail, the Live seam, and
    swipe-up transcript paging are gone; History (header button, unchanged) is the one transcript
    surface.
  - History page now stays current while open: new turns appear in place (a scrolled-up reader
    keeps their place), and `/clear` / session swaps are reflected.
- `scripts/check-version.sh` must print `✓`.

## Verification

1. `cd web && bun run test` — green (agent-chat rewrites, history.test.tsx new, seam/inline tests
   deleted).
2. `bun run build` at the repo root — typechecks bridge + web, builds web atomically.
3. `scripts/check-version.sh` → `✓`.
4. Manual smoke (if a dev bridge is up): open an agent pane → only the live viewport, no journal
   turns, no seam; History button → parsed conversation; while History is open, let the agent
   produce a turn → it appears without leaving; scroll up first → position holds; `/clear` from the
   pane then re-open History → fresh session only.

## Out of scope (do not touch)

`bridge/journal/` adapters · the `/api/pane/:id/history` contract · turning History into raw CLI
text · find-in-output on the live pane · display-prefs / `rawTerminal` grammars · shell "Load older"
scrollback mechanics · traces · composer · settings.

## Deployment note

Web-only change — no bridge restart semantics change, but the deployment host needs
`bun run build` (the bridge serves `web/dist` from disk; since 0.42.0 it warns on stale builds).
Express update/restart instructions as Herdr plugin actions, never `collie-ctl.sh`.
