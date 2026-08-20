# Plan — Split `working` into thinking vs commands-running

**ADW:** `e92fdcb0` · **Version:** 0.45.1 → 0.46.0 (MINOR, new capability)

## Goal & invariants

`working` today conflates "thinking" with "running a command". Split the *presentation* only:

1. **Blue dot** — when a `working` agent's newest transcript turn holds a tool part with
   `result === undefined`, its StatusDot paints blue instead of amber (amber keeps the ping).
2. **Hidden live tail** — while that same pane's newest turn is commands-only, the live terminal
   tail hides (the transcript's new "running" tool row shows what is running instead).

**Invariants — do not break:**
- `AgentStatus` on the wire stays `idle | working | blocked | done | unknown`. **No sixth status.**
  `runningCommand` is a boolean *decoration* on `AgentView`, absent unless true.
- The signal is the existing pending-tool pairing in the journal parsers (`pendingTools` map in
  `bridge/journal/claude.ts:139/186`, same in codex/grok/pi; opencode's `status:"pending"` part
  already emits no `result` — `bridge/journal/opencode.ts:249`). No pane-text sniffing, no new
  regex, no Herdr change.
- Do not touch: `STATUS_RANK` (web/src/lib/types.ts:363 + bridge mirror), session summary counts,
  notify prefs, triage bucket keys / `lib/triage.ts`, tab & space roll-up dots (they show a triage
  bucket status, not a pane).

## 1. Backend — detect the pending tool and stamp the flag

### 1a. `bridge/types.ts` — AgentView field

Add to `AgentView` (after `terminalTitle` / near the other optional wire fields):

```ts
/**
 * True when the pane's journal shows a tool call with no result yet on its newest turn —
 * the agent is RUNNING A COMMAND rather than thinking. Decorates `working`; never a sixth
 * status. Only ever set true and only when cfg.transcript is on — absent means "no signal",
 * which the UI renders as today's amber. Stamped at snapshot time from the journal tail
 * (server.ts, same pattern as withActivity); rides the wire through toPaneWire untouched.
 */
runningCommand?: boolean;
```

Note in the `PaneWire` doc comment block that `runningCommand` is a wire field (it is NOT added to
the `Omit` — only `agentSession` is stripped, so the rest-spread in `toPaneWire` carries it
automatically).

### 1b. `bridge/journal/store.ts` — pending-tool probe on the store

Add an exported pure helper and a store method (reuses the existing mtime-keyed cache, so a poll
tick costs one `stat` per working pane once warm):

```ts
/** True when the NEWEST entry holds a tool call whose result hasn't been written yet — the
 *  agent is mid-command. Only the newest entry counts: results fold into the same entry
 *  (claude/pi mutate in place) or arrive as later rows, so anything older is settled. */
export function newestEntryPendingTool(entries: TranscriptEntry[]): boolean {
  if (entries.length === 0) return false;
  const last = entries[entries.length - 1]!;
  return last.parts.some((p) => p.kind === "tool" && p.result === undefined);
}
```

`TranscriptStore` method (mirror `page()`'s resolve → stat → cache-or-load flow):

```ts
/** True when the newest parsed turn holds a pending tool call; false when it doesn't; null when
 *  there is nothing to read (no log / refused ref / containment miss) — the caller omits the
 *  flag for null, exactly like `page()` returning null. */
async runningCommand(adapter: JournalAdapter, ref: AgentSessionRef): Promise<boolean | null>
```

Implementation: `resolve` → `stat` → cache-valid ? cached : `load` + `parse` (same LRU re-set /
eviction as `page`). Then `return newestEntryPendingTool(entry.entries)`.

### 1c. `bridge/server.ts` — stamp at snapshot serialise time

In the `/api/snapshot` handler (server.ts:240–283), follow the `withActivity` precedent — **do not
put journal I/O in the state engine**; the engine stays a pure Herdr poller (its header comment and
the comment at server.ts:247–249 say so explicitly).

- Only when `journals !== null && transcripts !== null` (i.e. `cfg.transcript` on — they are
  constructed with `cfg.transcript ? … : null` at server.ts:180–181). Off → the whole decoration is
  skipped and the flag is omitted (today's amber).
- For each agent pane with `status === "working"`, resolve exactly like `paneHistory`
  (server.ts:678–691): `adapterFor(journals, p.agent)`, then
  `ref = p.agentSession ?? (adapter.inferFromCwd?.(p.cwd) ?? null)` (the `??` chain covers Grok's
  cwd-inferred sessions). No adapter / no ref → skip.
- `const running = await transcripts.runningCommand(adapter, ref);` — `true` → spread
  `{ ...p, runningCommand: true }`; `false`/`null`/throw → `p`. Wrap each pane's probe in
  try/catch; a failed read must never fail the snapshot.
- Run the probes with `Promise.all` over the working agents only (idle/done/blocked panes cost
  nothing), then feed the decorated `AgentView`s through the existing
  `withActivity` → `toPaneWire` chain unchanged.
- Update the block comment above the `agents:` serialise line to mention the new stamp.

### 1d. Frontend type — `web/src/lib/types.ts`

Add the same optional `runningCommand?: boolean` to `AgentView` (doc: absent = no signal = amber;
mirrors `bridge/types.ts`).

## 2. Frontend — blue dot

### 2a. `web/src/index.css` — the colour token

In the `--status-*` block (index.css:108–112), add a blue at the SAME lightness/chroma ramp as
`working` so it does not out-shout `blocked` (see the solid-vs-hollow comment in
status-badge.tsx:24–32 — the ramp is the thing that keeps dots balanced):

```css
--status-running: light-dark(oklch(0.46 0.12 250), oklch(0.82 0.15 250));
```

(same L/C as `--status-working`, hue ~250 blue) and in the `@theme` mapping
(index.css:176–180): `--color-status-running: var(--status-running);`.

### 2b. `web/src/components/status-badge.tsx` — StatusDot / StatusBadge

- `StatusDot` gains `runningCommand?: boolean`. When `status === "working" && runningCommand`:
  - the dot fills `bg-status-running` (solid — it is a "something is happening" state, NOT added
    to `RESTING`);
  - **no `animate-ping`** — the amber ping stays reserved for thinking. Gate the existing ping span
    on `status === "working" && !running`.
- `StatusBadge` (the pane header chip, agent-chat.tsx:730) gains the same prop and swaps its inner
  dot's fill for `bg-status-running` under the same condition. The label stays "working".

### 2c. Call sites — pass the flag where a pane `AgentView` is in hand

- `web/src/components/space-tree.tsx:365` (pane row): `<StatusDot status={pStatus} runningCommand={p.runningCommand} />` — only the pane row; the tab (327) and space (259) dots show triage buckets and are out of scope.
- `web/src/components/agent-card.tsx:130`: pass `agent.runningCommand`. (The `StatusBadge` at :192 may take it too — cheap and coherent.)
- `web/src/components/pane-strip.tsx:132`: pass `pane.runningCommand`.
- `web/src/components/agent-chat.tsx:730`: pass `agent.runningCommand` to `StatusBadge`.
- `web/src/components/ui/chip.tsx` — do NOT touch (triage bucket status).

## 3. Frontend — hide the live tail while commands-only

### 3a. `web/src/lib/transcript-seam.ts`

- Add `commandsOnly?: boolean` to `LiveMirrorNeed`.
- Add an exported helper (so agent-chat and the tests share one definition):

```ts
/** True when the newest transcript turn holds a tool call with no result yet — the agent is
 *  running commands, not writing prose, so the terminal tail is a spinner we already summarise
 *  as the transcript's running tool row. */
export function commandsOnlyTurn(entries: TranscriptEntry[]): boolean {
  if (entries.length === 0) return false;
  const last = entries[entries.length - 1]!;
  return last.parts.some((p) => p.kind === "tool" && p.result === undefined);
}
```

- In `liveMirrorNeeded`, insert an EXPLICIT branch **after the `dialogPresent` check and before
  the `working/blocked/unknown` status check**:

```ts
if (opts.commandsOnly) return false;
```

  Reason for the placement (write it as a comment): the existing fall-through
  `return !opts.newestTurnInViewport` can never fire for a tool-parts-only newest turn —
  `newestTurnInViewport` (transcript-seam.ts:174–181) requires a non-empty **text** part and
  tool summaries are Collie's own wording, never screen text. Without this branch the tail would
  stay up for exactly the case it must hide. `pinned` (Show live), `rawTerminal`, `findOpen`,
  `dialogPresent` all short-circuit earlier and keep winning — a dialog's buttons live in the tail,
  so it must outrank commands-only.

### 3b. `web/src/components/agent-chat.tsx` (~line 302–311)

```ts
const commandsOnly = commandsOnlyTurn(inline.entries);
```

and pass `commandsOnly` into the existing `liveMirrorNeeded({...})` call. No other change —
`visibleEntries` already switches on `showLive`, and `opts.pinned` keeps "Show live" working.

### 3c. `web/src/components/transcript-view.tsx` — running tool row

In `ToolPart` (~line 60): when `result === undefined`, the row is a **running** row rather than a
dead disabled row. Keep the existing button (still `disabled` — nothing to expand), and append a
running marker in place of the chevron, e.g.:

```tsx
{!result && (
  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground animate-pulse">
    running
  </span>
)}
```

so a hidden tail is never a blank screen: the operator sees `Bash · npm test` with a "running"
marker. Nothing else in the component changes; keep the XSS boundary (text nodes only).

## 4. Tests

**Frontend (`cd web && bun run test`):**

- `web/src/lib/transcript-seam.test.ts` — add cases for `liveMirrorNeeded` with `commandsOnly`:
  - `working + commandsOnly + hasTranscript` → **false** (the new behaviour; today it returns true);
  - `pinned` still returns true with commandsOnly (Show live is the escape hatch);
  - `dialogPresent` still returns true with commandsOnly;
  - `commandsOnly` unset + `working` → true (today's behaviour unchanged);
  - `rawTerminal`/`findOpen` still win.
  - Plus direct tests of `commandsOnlyTurn`: pending tool on newest entry → true; result attached →
    false; newest entry text-only → false; empty → false.
- `web/src/components/status-badge.test.tsx` (new file) — render the **shipped** components:
  - `StatusDot status="working" runningCommand` → has the `bg-status-running` class and NO
    `animate-ping` descendant;
  - `StatusDot status="working"` (no flag) → amber `bg-status-working` + ping present;
  - flag with a non-working status (e.g. `idle`) → ignored (resting ring as today);
  - `StatusBadge status="working" runningCommand` → blue inner dot.
- `web/src/components/transcript-view.test.tsx` — a tool part with no `result` renders the name,
  summary and a "running" marker; one with a result does not.

**Backend (`bun test ./bridge ./scripts`):**

- `bridge/journal/store.test.ts` — the fake-adapter fixture pattern already exists there:
  - `runningCommand` → true when the newest parsed entry holds a pending tool part;
  - → false when the result row has folded in;
  - → null when resolve returns null (no log) — flag omitted, cfg-amber preserved;
  - cache behaviour: a second call with unchanged size/mtime does not re-load (assert via the
    fixture's call counter, same technique as the existing page tests);
  - direct unit tests of `newestEntryPendingTool` (pure).
- `bridge/wire.test.ts` — `toPaneWire` passes `runningCommand: true` through to the wire shape.
- Optional but preferred if the fixture plumbing is cheap: one `/api/snapshot` test in
  `bridge/server.test.ts` planting a claude-shaped `.jsonl` fixture under the fake journal root,
  asserting `runningCommand: true` on a working pane and absent on an idle one — and absent when
  `cfg.transcript: false`.

Do not re-implement the dot logic in tests — assert against the rendered shipped components.

## 5. Versioning & CHANGELOG (MANDATORY)

Functional change (bridge/ + web/src/) → MINOR bump **0.45.1 → 0.46.0**, all in one commit-set:

1. Land the functional commits first (blue dot + hidden tail can be one or two commits).
2. Release commit: bump `herdr-plugin.toml`, `package.json`, `web/package.json` to `0.46.0` and add
   to `CHANGELOG.md` under `## [0.46.0] - <real date>` (use `date +%Y-%m-%d`), section **Added**,
   one line per change, each citing the feature commit's short hash:
   - blue status dot while an agent runs commands (thinking stays amber);
   - live tail hides while the newest turn is a running command (Show live still pins it), with a
     running tool row in the transcript.
3. `scripts/check-version.sh` must print `✓`.

## 6. Verification

1. `cd web && bun run test` — green, including the new seam/status-badge/transcript-view cases.
2. `bun test ./bridge ./scripts` — green.
3. `bun run build` (root) — both typechecks + web build pass.
4. `scripts/check-version.sh` → `✓`.
5. Manual smoke if a live bridge is reachable: a claude pane mid-`Bash` shows a blue dot on the
   tree row and the pane header chip; the pane view hides the terminal tail and shows
   `Bash · <cmd> running`; tapping "Show live" restores the tail; when the agent goes back to
   thinking (text streaming) the dot returns to amber ping and the tail returns.

## 7. Out of scope (do not do)

A sixth `AgentStatus` · Herdr API / `HERDR_API.md` · `STATUS_RANK` · notify prefs · triage
classifier (`lib/triage.ts`) · session-summary working-count meaning · `adws/` · `quality.py` /
`permissions.py` · other issues · docs PRs #84/#86.
