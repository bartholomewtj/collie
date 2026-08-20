# Split Working Status: Thinking vs Commands-Running

## What Changed

Previously, an agent with `working` status always displayed an amber pulsing status dot and rendered the live terminal tail whenever active. This conflated when the agent was reasoning/thinking (generating prose / streaming tokens) with when it was executing shell commands or tools (where the terminal output is often noisy command output or a spinner).

In version 0.46.0, this presentation is split into two distinct states without adding a sixth `AgentStatus`:
1. **Blue Status Dot for Running Commands**: When an agent in `working` status has a newest transcript turn holding a pending tool call (`result === undefined`), `AgentView.runningCommand` is set to `true`. In the UI, `StatusDot` and `StatusBadge` render a solid blue dot (`--status-running` CSS token, no `animate-ping`) instead of the pulsing amber dot. Non-working statuses and thinking agents (where `runningCommand` is absent or false) retain their existing styling.
2. **Hidden Live Tail During Commands-Only Turns**: While an agent's newest turn is executing a command (`commandsOnlyTurn`), `liveMirrorNeeded` evaluates to `false`, hiding the live terminal mirror to reduce noise. Instead, `TranscriptView` displays a dedicated running tool row (`<tool> · <summary> · running` with an animated pulse). Pinned live view ("Show live"), active interactive dialogs, shell panes, raw terminal mode, and search continue to override this and keep the live mirror visible.

On the backend, `TranscriptStore.runningCommand` uses cached journal stats and parses the newest transcript entry. When `cfg.transcript` is enabled, the `/api/snapshot` handler stamps `runningCommand: true` onto active working agent panes during serialization. When transcripts are disabled or no session log exists, the flag is omitted (falling back to amber thinking status).

## Key Files & Changes

- `bridge/types.ts` & `web/src/lib/types.ts`: Added optional `runningCommand?: boolean` to `AgentView`.
- `bridge/journal/store.ts`: Added `newestEntryPendingTool` helper and `TranscriptStore.runningCommand(adapter, ref)` method.
- `bridge/journal/store.test.ts`: Added unit tests for `newestEntryPendingTool` and `TranscriptStore.runningCommand` caching and status detection.
- `bridge/server.ts`: Stamped `runningCommand: true` on `working` agents during snapshot assembly when transcripts are active.
- `bridge/wire.test.ts`: Verified `toPaneWire` preserves `runningCommand`.
- `web/src/index.css`: Added `--status-running` and `--color-status-running` matching the lightness/chroma ramp of `--status-working`.
- `web/src/components/status-badge.tsx`: Updated `StatusDot` and `StatusBadge` to accept `runningCommand` and render solid blue without ping when true.
- `web/src/components/status-badge.test.tsx`: Added tests verifying amber pulsing for thinking, solid blue for running commands, and ignoring the flag on non-working statuses.
- `web/src/components/space-tree.tsx`, `web/src/components/agent-card.tsx`, `web/src/components/pane-strip.tsx`, & `web/src/components/agent-chat.tsx`: Forwarded `runningCommand` to `StatusDot` and `StatusBadge`.
- `web/src/lib/transcript-seam.ts`: Added `commandsOnlyTurn` helper and updated `liveMirrorNeeded` with a `commandsOnly` check prior to general `working` status tail checks.
- `web/src/lib/transcript-seam.test.ts`: Added tests for `commandsOnlyTurn` and `liveMirrorNeeded` with `commandsOnly` (including override checks for `pinned`, `dialogPresent`, etc.).
- `web/src/components/transcript-view.tsx` & `web/src/components/transcript-view.test.tsx`: Added running indicator (`running` text with `animate-pulse`) on uncompleted tool rows.
- `herdr-plugin.toml`, `package.json`, `web/package.json`, & `CHANGELOG.md`: Bumped version from `0.45.1` to `0.46.0`.

## How to Verify

1. **Frontend Tests**:
   ```bash
   cd web && bun run test
   ```
   Validates seam logic, status badge rendering, and transcript view running states.

2. **Backend Tests**:
   ```bash
   bun test ./bridge ./scripts
   ```
   Validates journal store pending tool parsing, cache reuse, and wire serialization.

3. **Version Check & Build**:
   ```bash
   scripts/check-version.sh
   bun run build
   ```
