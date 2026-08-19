# Collie — ICM System Map & Context Router

> **Form**: System Map (ICM Form 6 — Van Clief & McDermott, [arXiv:2603.16021](https://arxiv.org/abs/2603.16021))  
> **Target**: `AltanS/collie` (forked repo on Windows at `C:\ClaudeOS\Projects\collie`)  
> **Entry Twins**: [`CLAUDE.md`](file:///C:/ClaudeOS/Projects/collie/CLAUDE.md) · [`AGENTS.md`](file:///C:/ClaudeOS/Projects/collie/AGENTS.md) · [`CONTEXT.md`](file:///C:/ClaudeOS/Projects/collie/CONTEXT.md)  
> **Current Version**: `0.40.3` (`v0.40.3`) | Herdr Plugin: `herdr.collie`

---

## 1. Universes & Concept Disambiguations

### Universes
| Universe | Scope & Files | Maintenance Rule |
|---|---|---|
| **live** | `bridge/*.ts` (Bun backend), `web/src/` (Vite+React frontend), `scripts/collie-ctl.sh`, `herdr-plugin.toml`, `.adr/` | Active implementation. Changes must pass `scripts/check-version.sh` and tests (`bun test`). |
| **leftover** | `contrib/windows/`, `app_docs/`, historical specs in `specs/`, legacy test scripts `scripts/push-test.ts` | Historical documentation and auxiliary platform scripts. Reference only; do not refactor without reason. |
| **ghost** | Speculative features parked in [`ARCHITECTURE.md §8`](file:///C:/ClaudeOS/Projects/collie/ARCHITECTURE.md#L273-L288) (`herdr terminal session observe`/`control`, client-side terminal emulator, auto-speech recognition APIs) | **Do not implement**. Explicitly closed by ADRs (e.g. [ADR 0008](file:///C:/ClaudeOS/Projects/collie/.adr/0008-collie-does-not-run-a-terminal-emulator.md)). |

### Name & Concept Collisions
- **Herdr Workspace vs Collie Space**: Herdr `workspace_id` maps 1:1 to Collie's "Space" route (`/space/:spaceId`). A Space contains multiple Tabs, and each Tab contains Panes.
- **Herdr Pane vs Agent Chat View**: Herdr manages raw PTY panes (`pane_id`). Collie renders agent-bearing panes through `AgentChat` ([`web/src/components/agent-chat.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/components/agent-chat.tsx)) with prompt parsing; bare shell panes fallback to raw mirror.
- **Session Identity**:
  - *Agent Session UUID*: Agent's on-disk transcript id ([`bridge/journal/`](file:///C:/ClaudeOS/Projects/collie/bridge/journal/)).
  - *Herdr Session*: The daemon state returned in `session.snapshot`.
  - *Collie Multi-Session URL*: `?s=<name>` query param scoped in [`web/src/lib/session.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/session.ts).
- **Idle Lock**: A client-side visual pause ([`web/src/lib/idle.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/idle.ts), [ADR 0007](file:///C:/ClaudeOS/Projects/collie/.adr/0007-the-idle-lock-is-a-pause-not-a-gate.md)) that stops polling on unattended screens. **It is NOT a security gate**.
- **Type Into Terminal**: A transient send mode ([`web/src/components/send-mode-menu.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/components/send-mode-menu.tsx)) armed per-action, never persisted, disarmed on pane switch.
- **SSSF Traces**: Single Session Subagent Framework trace visualizer mounted as a sandboxed iframe from `SSSF_VIZ_DIR` ([`bridge/sssf-viz.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/sssf-viz.ts), [ADR 0024](file:///C:/ClaudeOS/Projects/collie/.adr/0024-the-sssf-module-is-the-second-filesystem-reader.md)).

---

## 2. Noun Taxonomy (Object Cards)

```
                       ┌────────────────────────┐
                       │   Herdr Unix Socket    │
                       └───────────┬────────────┘
                                   │ (NDJSON RPC / Named Pipe)
                       ┌───────────▼────────────┐
                       │   HerdrSocketClient    │
                       └─────┬────────────┬─────┘
           Snapshot Poll tick│            │events.subscribe (poke)
                       ┌─────▼────────────▼─────┐
                       │      StateEngine       │
                       └───────────┬────────────┘
                                   │
                       ┌───────────▼────────────┐
                       │       HttpServer       │◄─── JournalRegistry & Files
                       │    (bridge/server)     │◄─── SssfVizMount
                       └───────────┬────────────┘
                                   │ (HTTP /api/snapshot poll & mutations)
                       ┌───────────▼────────────┐
                       │     React Loaders      │
                       │    (web/src/lib)       │
                       └───────────┬────────────┘
                                   │
                       ┌───────────▼────────────┐
                       │    Harness Registry    │
                       │   (Block AST Parser)   │
                       └─────┬────────────┬─────┘
                             │            │
         ┌───────────────────▼──┐      ┌──▼──────────────────┐
         │ Prompt/Wizard Blocks │      │ AnsiOutput (Mirror) │
         └──────────────────────┘      └─────────────────────┘
```

### Bridge Objects (Backend — `bridge/`)

#### 1. [`HttpServer`](file:///C:/ClaudeOS/Projects/collie/bridge/server.ts#L1-L1694)
- **Role**: `Bun.serve` daemon binding `127.0.0.1:$COLLIE_PORT` (default 8787).
- **Why this shape**: Serves static `web/dist` from disk at request time (zero-restart frontend updates) and provides the REST API.
- **Boundaries & Security**: Enforces loopback check ([`isLoopbackBindHost`](file:///C:/ClaudeOS/Projects/collie/bridge/config.ts#L15-L35)), origin validation ([`COLLIE_ALLOWED_ORIGINS`](file:///C:/ClaudeOS/Projects/collie/bridge/config.ts#L70-L95)), fail-closed host headers ([ADR 0023](file:///C:/ClaudeOS/Projects/collie/.adr/0023-host-validation-is-fail-closed.md)), trusted user ([`COLLIE_TRUSTED_USER`](file:///C:/ClaudeOS/Projects/collie/bridge/config.ts#L100-L120)), and device header auth ([`COLLIE_DEVICE_HEADER`](file:///C:/ClaudeOS/Projects/collie/bridge/config.ts#L125-L145)).
- **Connected to**: [`HerdrClient`](file:///C:/ClaudeOS/Projects/collie/bridge/herdr-client.ts), [`StateEngine`](file:///C:/ClaudeOS/Projects/collie/bridge/state-engine.ts), [`JournalRegistry`](file:///C:/ClaudeOS/Projects/collie/bridge/journal/registry.ts), [`SssfViz`](file:///C:/ClaudeOS/Projects/collie/bridge/sssf-viz.ts), [`Push`](file:///C:/ClaudeOS/Projects/collie/bridge/push.ts).

#### 2. [`HerdrSocketClient`](file:///C:/ClaudeOS/Projects/collie/bridge/herdr-client.ts#L1-L495)
- **Role**: The **sole** module knowing Herdr's wire protocol and RPC method names (`session.snapshot`, `pane.read`, `pane.send_keys`, `agent.send`, `pane.rename`, `pane.close`, `events.subscribe`).
- **Why this shape**: Isolates upstream Herdr API changes to a single file. Speaks newline-delimited JSON-RPC over `Bun.connect({unix})` on POSIX and `node:net` on Windows named pipes via [`dial.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/dial.ts#L1-L140). One-shot connection per RPC.

#### 3. [`StateEngine`](file:///C:/ClaudeOS/Projects/collie/bridge/state-engine.ts#L1-L393) & [`EventPoker`](file:///C:/ClaudeOS/Projects/collie/bridge/event-poker.ts#L1-L200)
- **Role**: Polling orchestrator and status cache.
- **Why this shape**: Polling Herdr (`session.snapshot`) guarantees eventual consistency without complex resync. `EventPoker` consumes `events.subscribe` and pokes `StateEngine` for an immediate debounced re-poll when agent status changes.

#### 4. [`JournalRegistry`](file:///C:/ClaudeOS/Projects/collie/bridge/journal/registry.ts#L1-L80) & [`Files`](file:///C:/ClaudeOS/Projects/collie/bridge/journal/files.ts#L1-L140)
- **Role**: Reads conversation history from agent-native log files on disk (Claude JSONL, OpenAI Codex, Pi, OpenCode, Grok).
- **Security Invariant**: Absolute containment via [`containedRealpath`](file:///C:/ClaudeOS/Projects/collie/bridge/journal/files.ts#L25-L65). Rejects symlink escapes outside configured agent roots.

#### 5. [`SssfVizMount`](file:///C:/ClaudeOS/Projects/collie/bridge/sssf-viz.ts#L1-L750)
- **Role**: Discovers `adws/adw_data/sssf.db` (scanning ≤2 levels up/down from workspace cwds), matches repos, and serves the SSSF trace visualizer iframe at `/sssf/*`.

---

### Web Objects (Frontend — `web/src/`)

#### 1. [`Router & Loaders`](file:///C:/ClaudeOS/Projects/collie/web/src/router.tsx#L1-L59) / [`loaders.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/loaders.ts#L1-L412)
- **Role**: React Router v6 Data Mode router (`createBrowserRouter`). **NO TanStack Query**.
- **Data Flow**: `rootLoader` (`/api/snapshot`), `paneLoader` (`/api/pane/:paneId`), `historyLoader` (`/api/pane/:paneId/history`). Polling is driven by [`usePolling`](file:///C:/ClaudeOS/Projects/collie/web/src/hooks/use-polling.ts) calling `useRevalidator().revalidate()`.

#### 2. [`HarnessRegistry`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/harness/registry.ts#L1-L34) & [`Block AST`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/blocks.ts#L1-L231)
- **Role**: Intermediate AST between raw ANSI text and React interactive UI components.
- **Pipeline**: `parseAnsi(text)` → `StyledLine[]` → `adapter.buildBlocks()` → `Block[]`.
- **Block Kinds**: `raw`, `prompt-select`, `preview-select`, `wizard`, `menu`, `multi-select`.
- **Adapters**: [`claudeAdapter`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/harness/claude/), [`grokAdapter`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/harness/grok/), [`ompAdapter`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/harness/omp/).

#### 3. [`AnsiOutput`](file:///C:/ClaudeOS/Projects/collie/web/src/components/ansi-output.tsx#L1-L350)
- **Role**: Terminal mirror renderer.
- **Security Invariant**: Renders ANSI as **React text nodes only** (never `innerHTML`). Enforces inverted light theme ([ADR 0002](file:///C:/ClaudeOS/Projects/collie/.adr/0002-invert-the-light-terminal-mirror.md)).

#### 4. [`Composer`](file:///C:/ClaudeOS/Projects/collie/web/src/components/composer.tsx#L1-L950) & [`ReplyGuard`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/reply-action.ts#L1-L300)
- **Role**: Mobile input box supporting native voice dictation, direct typing, quick actions, and key sequences.
- **Guards**: Checks prompt binding (`expected_prompt`), validates paste placeholders (`[Pasted text #N +M lines]`, [ADR 0010](file:///C:/ClaudeOS/Projects/collie/.adr/0010-long-sends-are-verified-via-the-paste-placeholder.md)), confirms destructive shell commands (`rm`, `dd`, `sudo` via [`destructive.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/destructive.ts)).

---

## 3. Verbs (Core Runtime Processes)

### Process 1: Polling & State Synchronisation
```
Herdr Daemon (Unix Socket / Pipe)
   │  1. session.snapshot (or workspace.list / pane.list fallback)
   ▼
bridge/state-engine.ts (poll loop every COLLIE_POLL_MS / COLLIE_POLL_IDLE_MS)
   ▲  2. events.subscribe stream pokes immediate debounced re-poll
   │
bridge/server.ts (/api/snapshot HTTP endpoint)
   │  3. GET /api/snapshot (React Router useRevalidator loop)
   ▼
web/src/lib/loaders.ts ──► React Router Component Tree
```

### Process 2: Interaction & Send Action Execution
```
User taps Prompt Block / Composer Send
   │  1. Dialog Guard verifies prompt signature on screen (lib/dialog-guard.ts)
   ▼
web/src/lib/api.ts (POST /api/send with text, action, or key sequence)
   │  2. HTTP Request with expected_prompt & tailnet identity header
   ▼
bridge/server.ts
   │  3. Access gate check (trusted user / device header / loopback)
   │  4. Prompt binding check (pane.read tail match against expected_prompt)
   │  5. Audit log line appended (<stateDir>/audit.log mode 0600)
   ▼
bridge/herdr-client.ts
   │  6. One-shot RPC: agent.send + Enter OR pane.send_keys
   ▼
Herdr Socket ──► Agent Process in PTY
```

### Process 3: Journal / Transcript History Retrieval
```
User navigates to /pane/:paneId/history
   │  1. GET /api/pane/:paneId/history
   ▼
bridge/server.ts
   │  2. Identify agent harness from pane snapshot
   │  3. Resolve transcript path via harness adapter (bridge/journal/registry.ts)
   │  4. Enforce containedRealpath(root, path) (bridge/journal/files.ts)
   │  5. Parse JSONL / raw session log into TranscriptEntry[]
   ▼
web/src/routes/history.tsx (renders scrollback turns with find & jump-to-turn)
```

---

## 4. Change-Impact Matrix (Effects Waterfall)

| When you change... | You MUST open & edit... | Do NOT touch... |
|---|---|---|
| **Herdr Socket RPC / Wire Methods** | [`bridge/herdr-client.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/herdr-client.ts), [`bridge/types.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/types.ts), [`HERDR_API.md`](file:///C:/ClaudeOS/Projects/collie/HERDR_API.md) | `web/src/`, `bridge/server.ts` |
| **New Agent Grammar (e.g. Codex, Pi UI)** | [`web/src/lib/harness/registry.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/harness/registry.ts), `web/src/lib/harness/<agent>/`, [`bridge/journal/registry.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/journal/registry.ts) | `web/src/router.tsx`, `bridge/herdr-client.ts` |
| **Terminal Rendering & Colors** | [`web/src/components/ansi-output.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/components/ansi-output.tsx), [`web/src/lib/ansi.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/ansi.ts), [`web/src/index.css`](file:///C:/ClaudeOS/Projects/collie/web/src/index.css) | Backend bridge files |
| **Auth, Ingress, & Network Security** | [`bridge/config.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/config.ts), [`bridge/server.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/server.ts), [`DEPLOYMENT.md`](file:///C:/ClaudeOS/Projects/collie/DEPLOYMENT.md), `.adr/0023*` | `web/src/lib/harness/` |
| **Web Routes & Navigation** | [`web/src/router.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/router.tsx), [`web/src/lib/loaders.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/loaders.ts), `web/src/routes/` | Bridge state engine |
| **SSSF Visualizer Integration** | [`bridge/sssf-viz.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/sssf-viz.ts), [`web/src/components/sssf-frame.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/components/sssf-frame.tsx), [`web/src/routes/traces.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/routes/traces.tsx) | `bridge/herdr-client.ts` |
| **Version & Releases** | [`herdr-plugin.toml`](file:///C:/ClaudeOS/Projects/collie/herdr-plugin.toml), [`package.json`](file:///C:/ClaudeOS/Projects/collie/package.json), [`web/package.json`](file:///C:/ClaudeOS/Projects/collie/web/package.json), [`CHANGELOG.md`](file:///C:/ClaudeOS/Projects/collie/CHANGELOG.md) | Code files |

---

## 5. Architectural Invariants & Rules

1. **Mandatory Version Synchronization**:
   - `herdr-plugin.toml`, `package.json`, `web/package.json`, and the top entry in `CHANGELOG.md` **must always match**.
   - Validated by running `scripts/check-version.sh`.
2. **Frontend Rebuild & Disk Serving**:
   - `web/dist` is served by Bun directly from disk at request time. Web changes do **not** require a systemd daemon restart — just `bun run build`.
   - Backend changes (`bridge/*.ts`) **always require restarting the service** (`systemctl --user restart collie` or `collie-ctl.ps1 restart`).
3. **No TanStack Query & No Client-Side Terminal Emulator**:
   - Data fetching is 100% React Router loaders + `useRevalidator()`.
   - Collie renders Herdr's pre-computed grid as React text nodes; never run xterm.js or an emulator inside Collie ([ADR 0008](file:///C:/ClaudeOS/Projects/collie/.adr/0008-collie-does-not-run-a-terminal-emulator.md)).
4. **Security & Ingress Posture**:
   - Loopback bind only (`127.0.0.1`). Fail-closed origin/host validation.
   - Single front-door architecture (`tailscale serve` or reverse proxy; **never `tailscale funnel`**).
   - Strict Content Security Policy (`default-src 'self'`). Zero `innerHTML` on terminal output.
5. **Path Containment**:
   - Every file read by the bridge goes through `containedRealpath` ([`bridge/journal/files.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/journal/files.ts)) against allowed root directories.

---

## 6. Fast Navigation Directory for LLMs

| Task | Primary Files to Load |
|---|---|
| **Investigate / Fix Backend Socket RPC** | [`bridge/herdr-client.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/herdr-client.ts) · [`bridge/dial.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/dial.ts) · [`bridge/types.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/types.ts) · [`HERDR_API.md`](file:///C:/ClaudeOS/Projects/collie/HERDR_API.md) |
| **Investigate / Fix Polling or Transitions** | [`bridge/state-engine.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/state-engine.ts) · [`bridge/event-poker.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/event-poker.ts) · [`web/src/hooks/use-polling.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/hooks/use-polling.ts) |
| **Investigate / Add Prompt Block Detection** | [`web/src/lib/blocks.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/blocks.ts) · [`web/src/lib/harness/registry.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/harness/registry.ts) · [`web/src/lib/harness/claude/`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/harness/claude/) |
| **Investigate / Fix Composer & Input Sending** | [`web/src/components/composer.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/components/composer.tsx) · [`web/src/lib/reply-action.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/reply-action.ts) · [`web/src/lib/dialog-guard.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/dialog-guard.ts) |
| **Investigate / Fix Session History Logs** | [`bridge/journal/registry.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/journal/registry.ts) · [`bridge/journal/claude.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/journal/claude.ts) · [`bridge/journal/files.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/journal/files.ts) · [`web/src/routes/history.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/routes/history.tsx) |
| **Investigate / Fix Long-press Actions (rename / close)** | [`web/src/hooks/use-long-press.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/hooks/use-long-press.ts) · [`web/src/components/pane-actions-sheet.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/components/pane-actions-sheet.tsx) · [`web/src/components/tab-actions-sheet.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/components/tab-actions-sheet.tsx) · [`web/src/components/space-actions-sheet.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/components/space-actions-sheet.tsx) · [`web/src/components/action-sheet-rows.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/components/action-sheet-rows.tsx) |
| **Add / Fix Operator Rows (`commands.toml`: `[[commands]]` palette, `[[quick]]` Quick dock)** | [`bridge/operator-commands.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/operator-commands.ts) · [`web/src/lib/agent-commands.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/agent-commands.ts) · [`web/src/lib/quick-replies.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/quick-replies.ts) · [`web/src/lib/operator-commands.ts`](file:///C:/ClaudeOS/Projects/collie/web/src/lib/operator-commands.ts) · [`commands.toml.example`](file:///C:/ClaudeOS/Projects/collie/commands.toml.example) |
| **Investigate / Fix SSSF Traces Tab** | [`bridge/sssf-viz.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/sssf-viz.ts) · [`web/src/components/sssf-frame.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/components/sssf-frame.tsx) · [`web/src/routes/traces.tsx`](file:///C:/ClaudeOS/Projects/collie/web/src/routes/traces.tsx) |
| **Investigate Auth / Security / Binding** | [`bridge/server.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/server.ts) · [`bridge/config.ts`](file:///C:/ClaudeOS/Projects/collie/bridge/config.ts) · [`DEPLOYMENT.md`](file:///C:/ClaudeOS/Projects/collie/DEPLOYMENT.md) |
| **Investigate CLI / Deployment Scripts** | [`scripts/collie-ctl.sh`](file:///C:/ClaudeOS/Projects/collie/scripts/collie-ctl.sh) · [`justfile`](file:///C:/ClaudeOS/Projects/collie/justfile) · [`herdr-plugin.toml`](file:///C:/ClaudeOS/Projects/collie/herdr-plugin.toml) |
