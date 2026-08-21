# Collie — system map

> **What this is**: the map. Where things live, what talks to what, and which files to open for a
> task. **Rules** (versioning, security posture, don't-do-this) live in [`CLAUDE.md`](./CLAUDE.md) —
> not restated here. **Why-not** decisions live in [`.adr/`](./.adr/README.md).
> Form: ICM System Map (Van Clief & McDermott, [arXiv:2603.16021](https://arxiv.org/abs/2603.16021)).
>
> **This checkout runs on Windows** (`C:\ClaudeOS\Projects\tools\collie`, fork of `AltanS/collie`, remote
> `bartholomewtj/collie`). Upstream and the docs assume Linux + systemd; on this box the bridge is
> started/stopped by `contrib/windows/collie-ctl.ps1` (Task Scheduler job is `wscript.exe` +
> `exec-bridge.vbs`, no console window). Herdr `update`/`restart`/`update-major` actions run
> `build/collie-action-v1.exe`. Current version and session state: [`NEXT-SESSION.md`](./NEXT-SESSION.md).

---

## 1. Universes — what is live, what is not

| Universe | Where | Rule |
|---|---|---|
| **live** | `bridge/` (Bun backend) · `web/src/` (Vite + React frontend) · `scripts/` · `herdr-plugin.toml` · `.adr/` · `contrib/windows/` (**live on this box** — the ctl bash script delegates `start/stop/restart/update` to `collie-ctl.ps1` on Git Bash) | Active code. Functional changes need a version bump (`CLAUDE.md` → Versioning) and pass `bun test`. |
| **factory** | `adws/` — claudeSSSF agent-workflow scripts (Python, `uv`) that *operate on* this repo. `adws/adw_data/sssf.db` is what the Traces tab reads. | Not app code. Don't edit `adws/adw_sssf_config/sssf.config.yaml` mid-run. |
| **historical** | `specs/`, `requests/`, `app_docs/` — the plan/request/doc artefacts those factory runs produced, one file per issue. | Read for background on *why a change was made*; never the source of truth for how the code works now. |
| **ghost** | Ideas parked in [`ARCHITECTURE.md` §8](./ARCHITECTURE.md) — `herdr terminal session observe`/`control`, a client-side terminal emulator, speech APIs. | **Do not implement.** Closed by ADRs ([0008](./.adr/0008-collie-does-not-run-a-terminal-emulator.md)). |
| **generated / vendored** | `web/dist`, `web/dist-staging`, `build/`, `node_modules/`, `web/src/components/ui/` (shadcn — regenerate, don't hand-edit) | Don't edit by hand. |

### Names that collide

- **Herdr workspace vs Collie space** — same thing. Herdr `workspace_id` ↔ a space row in the home tree (there is no per-space route any more; `/space/:spaceId` redirects to `/`). A space holds tabs; a tab holds panes.
- **Herdr pane vs agent chat** — Herdr's `pane_id` is a raw PTY. Collie defaults to that raw mirror (`use-display-prefs`, `rawTerminal: true`, storage `collie:display-prefs:v5`). Turn **Raw terminal** off in Display settings (composer ⚙) to get `AgentChat` prompt parsing. Bare shells always stay on the raw mirror.
- **Raw terminal** — a persisted display pref, **on by default**. Not the same as **Type into terminal** (the send-mode toggle beside Keys).
- **Session** means three things: the agent's on-disk transcript id (`bridge/journal/`), Herdr's daemon session (`session.snapshot`), and Collie's multi-session URL `?s=<name>` (`web/src/lib/session.ts`, `bridge/sessions.ts`).
- **Idle lock** — a pause, not a security gate (`web/src/lib/idle.ts`, [ADR 0007](./.adr/0007-the-idle-lock-is-a-pause-not-a-gate.md)).
- **Type into terminal** — a per-session send mode armed by the "Type" toggle beside Keys; never persisted. Entry point + reasoning at the toggle in `web/src/components/composer.tsx`; the keystroke pump in `web/src/hooks/use-direct-typing.ts`. (Older docs cite a `send-mode-menu.tsx` — it no longer exists.)
- **SSSF** = Super Simple Software Factory (the `adws/` universe above). Its trace visualiser is an external Vue app that Collie mounts in an iframe at `/sssf/*` from `SSSF_VIZ_DIR` (`bridge/sssf-viz.ts`, [ADR 0024](./.adr/0024-the-sssf-module-is-the-second-filesystem-reader.md)).
- **Harness** — a CLI agent Collie can drive (`claude`, `codex`, `pi`, `grok`, `omp`, `opencode`). Two independent adapter sets share the word: **screen grammar** in `web/src/lib/harness/<name>/` (parses the live pane) and **journal adapters** in `bridge/journal/<name>.ts` (read the log on disk). Adding one: [`HARNESS_CONTRIBUTING.md`](./HARNESS_CONTRIBUTING.md).

---

## 2. Shape — one picture

```
 Herdr daemon (Unix socket / Windows named pipe, NDJSON JSON-RPC, one request per connection)
        │
        │ herdr-client.ts  ← the ONLY file that knows Herdr's method names (via dial.ts + wire.ts)
        ▼
 state-engine.ts  ──poll──►  snapshot (agents, shells, spaces, tabs)
        ▲ poke                              │
 event-poker.ts (events.subscribe)          │
                                            ▼
 server.ts  (Bun.serve on 127.0.0.1:8787)  ── /api/* JSON  +  web/dist static from disk
   ├─ config.ts (env → Config), guard/checkAccess (same-origin, trusted user, device header, host)
   ├─ audit.ts (write-level actions → <stateDir>/audit.log)
   ├─ activity.ts / notifications.ts / notify-prefs.ts / snooze.ts / push.ts / push-endpoint.ts
   ├─ uploads.ts (images → <stateDir>/uploads), update.ts (newest v* tag), sessions.ts (?s=)
   ├─ journal/  (transcripts off disk — filesystem reader #1, contained by files.ts)
   └─ sssf-viz.ts (Traces iframe — filesystem reader #2)
        │
        │ HTTP: loaders.ts (React Router data mode) + api.ts mutations + use-polling.ts revalidate
        ▼
 web/src/  routes/ → components/ → lib/harness (screen grammar → Block AST) → blocks rendered
                                    lib/ansi.ts → components/ansi-output.tsx (mirror, text nodes only)
```

---

## 3. Bridge — every module, one line

`bridge/` is small enough to list in full. Tests sit beside each file as `*.test.ts`.

| File | Role |
|---|---|
| `index.ts` | Entry point. Loads config, starts state engine, event poker, notifications, push, server. Periodic journal rescan lives here. |
| `config.ts` | All env → `Config`, resolved once. Loopback-bind check (`isLoopbackBindHost`), `COLLIE_*` parsing, allowed origins/hosts, trusted user, device header. |
| `server.ts` | `Bun.serve` HTTP handler: every `/api/*` route (table below), access gate (`guard`, `checkAccess`, `isHostAllowed`), prompt-binding check, static serving with CSP, ETag/gzip. 1.7k lines — use the route table to jump. |
| `herdr-client.ts` | The Herdr socket adapter. Sole owner of RPC method names (`session.snapshot`, `pane.read`, `pane.send_keys`, `agent.send`, rename/close/move, `events.subscribe`). |
| `dial.ts` | Platform shim: `Bun.connect({unix})` on POSIX, `node:net` named pipe on Windows. |
| `wire.ts` | Pure NDJSON decoders for the wire protocol. |
| `write-drain.ts` | Backpressured socket write arithmetic (pure). |
| `state-engine.ts` | Poll loop (`COLLIE_POLL_MS` / `COLLIE_POLL_IDLE_MS`), builds the snapshot, emits transitions (blocked/done). |
| `event-poker.ts` | Long-lived `events.subscribe` stream whose only job is to poke the state engine for a debounced re-poll. |
| `types.ts` | Bridge domain model — our types, decoupled from Herdr's wire shapes. |
| `activity.ts` | Per-pane "last did something / last seen by you" (Herdr tracks neither). Feeds tree ordering and the seen header ([ADR 0003](./.adr/0003-one-shared-seen.md)). |
| `audit.ts` | Append-only audit log of write-level actions, mode 0600. |
| `notifications.ts` | Coordinator that gives every blocked/done alert one delivery decision (dedupe, escalation). |
| `notify-prefs.ts` | Which lifecycle events push at all ([ADR 0021](./.adr/0021-notification-settings-are-writes.md)). |
| `snooze.ts` | Global do-not-disturb deadline for push. |
| `push.ts` | Web Push (VAPID) sender; optional dependency, no-ops without keys. |
| `push-endpoint.ts` | Subscription endpoint validation (push-service host allowlist) + caps — closes the SSRF (issue #7). |
| `prompt-binding.ts` | Normalises a rendered prompt region so `expected_prompt` survives redraws. |
| `operator-commands.ts` | Reads the operator's `commands.toml` (`[[commands]]`, `[[quick]]`) behind an mtime check; rows replace, never merge ([ADR 0018](./.adr/0018-operator-command-rows-replace-the-catalog.md)). |
| `operator-file.ts` | Shared mtime-checked TOML reader for `commands.toml` and `keys.toml`. |
| `operator-keys.ts` | Reads `keys.toml` Keys-tray preset rows — same replace rule as commands. |
| `uploads.ts` | Uploaded images → `<stateDir>/uploads/`, referenced by path in the send. Magic-byte checked. |
| `update.ts` | Update-availability signal on `/api/snapshot.update` — polls this fork's newest `v*` tag (`COLLIE_UPDATE_REPO`). |
| `sessions.ts` | Multi-session: several named Herdr sessions, `?s=<name>` picks one. |
| `http-cache.ts` | Pure ETag / conditional GET / gzip helpers. |
| `platform-support.ts` | What the host OS can do (`POSIX_MODES`, `CAN_SYMLINK`, the latter probed). Test-only: the two POSIX facilities Windows lacks, so tests that need them skip with a reason rather than fail. |
| `sssf-viz.ts` | Discovers `adws/adw_data/sssf.db` near workspace cwds, serves the visualiser at `/sssf/*`. Filesystem reader #2. |
| `journal/registry.ts` | The single decision site for "which agents have readable history"; maps harness → adapter. |
| `journal/files.ts` | Filesystem half shared by adapters. **`containedRealpath` is the containment invariant** — every path any adapter reads goes through it. |
| `journal/store.ts` | Reads + caches parsed journals for whichever adapter the pane's agent selects. |
| `journal/text.ts` | Shared caps so one pathological log can't balloon a response. |
| `journal/types.ts` | `TranscriptEntry` and the adapter contract. |
| `journal/{claude,codex,pi,grok,opencode}.ts` | One adapter per harness — finds the session file, parses it. Probe real logs with `bun scripts/journal-probe.ts`. |

### `/api/*` → handler (all in `server.ts`)

| Route | Method | Handler | Level |
|---|---|---|---|
| `/api/snapshot` | GET | inline → `stateEngine.snapshot()` + `update` | read |
| `/api/config` | GET | inline (`push`, features, build id) | read |
| `/api/pane/:id` | GET | `readPane` | read |
| `/api/pane/:id/history` | GET | `paneHistory` → journal store | read |
| `/api/pane/:id/reply` | POST | `replyPane` → `sendReplySteps` (prompt binding + paste-placeholder verify) | write |
| `/api/pane/:id/keys` | POST | `keysPane` | write |
| `/api/pane/:id/upload` | POST | `uploadPane` | write |
| `/api/pane/:id/close` · `/rename` | POST | `closePane` · `renamePane` | write |
| `/api/tab` · `/api/tab/:id/rename` · `/close` | POST | `createTab` · `renameTab` · `closeTab` | write |
| `/api/workspace` · `/api/workspace/:id/rename` | POST | `createWorkspace` · `renameWorkspace` | write |
| `/api/subscribe` | POST | inline → `push-endpoint.ts` | write ([ADR 0021](./.adr/0021-notification-settings-are-writes.md)) |
| `/api/notifications/prefs` | GET · POST | inline → `notify-prefs.ts` | read · write |
| `/api/notifications/snooze` | POST | inline → `snooze.ts` | write |
| `/api/update/check` | POST | inline → `update.ts` (rate-limited) | read |
| `/sssf/*` | GET | `sssfViz.handle` | read |
| `/auth`, `/auth/*` | — | reserved placeholder (`isReservedAuthPath`) | — |
| everything else | GET | `serveStatic` from `web/dist` | read |

---

## 4. Web — folders, routes, and where the big pieces are

`web/src/` is ~180 files; this lists the folders and the files you'll actually open. Tests sit beside
each file as `*.test.ts(x)`.

### Folders

| Folder | What's in it |
|---|---|
| `routes/` | One file per screen (table below). `root.tsx` = layout, `BottomNav`, boot splash, error boundary. |
| `components/` | Screen pieces. `ui/` is shadcn (generated). Everything else is Collie's. |
| `lib/` | Non-React logic: API client, loaders, actions, guards, parsers. |
| `lib/harness/` | Screen grammar. **Shared models** (`prompt-model.ts`, `wizard-model.ts`, `menu-model.ts`, `multi-select-model.ts`, `preview-model.ts`, `dialog-contract.ts`, `guard.ts`, `conformance.ts`) + **one adapter folder per harness** (`claude/`, `grok/`, `omp/`) registered in `registry.ts`. `types.ts` is the adapter contract. |
| `lib/harness/claude/` | The most complete adapter: `chrome.ts` (input box, statusline bound), `markers.ts`, `prompt-select.ts`, `preview-select.ts`, `wizard.ts`, `multi-select.ts`, `menu.ts` (generic, runs last), `paste.ts` (placeholder verify). |
| `lib/grammar/` | Ground-truth notes on Claude's dialogs (`PLAN_FEEDBACK_NOTES.md`, `WIZARD_NOTES.md`, `NOTES_NOTES.md`). Re-read before touching the matching adapter file. |
| `hooks/` | React hooks — one concern each (`use-polling`, `use-long-press`, `use-direct-typing`, `use-key-queue`, `use-idle-lock`, `use-push`, `use-theme`, …). |
| `sw.ts` | Service worker (push receive, lazy Nerd Font caching). Registered from `main.tsx`. |

### Route → file

| Path | File | Loader |
|---|---|---|
| `/` (Spaces tree) | `routes/tree.tsx` → `components/space-tree.tsx` | `rootLoader` (`/api/snapshot`, on the layout) |
| `/spaces` → `/` | `routes/redirects.tsx` (`SpacesRedirect`) | — |
| `/space/:spaceId` → `/` | `routes/redirects.tsx` (`SpaceRedirect`) — expands that space first | — |
| `/traces` · `/traces/:spaceId/:repo` | `routes/traces.tsx` → `components/sssf-frame.tsx` | — |
| `/settings` | `routes/settings.tsx` | — |
| `/pane/:paneId` | **`routes/detail.tsx`** → `components/agent-chat.tsx` + `composer.tsx` | `paneLoader` |
| `/pane/:paneId/history` | `routes/history.tsx` → `components/transcript-view.tsx` | `historyLoader` |

Router: `router.tsx` (module-scoped, keeps location). Loaders: `lib/loaders.ts`. Polling: `hooks/use-polling.ts` → `useRevalidator()`. Mutations: `lib/api.ts` then revalidate. **React Router v7, package `react-router`** (not `react-router-dom`); no TanStack Query.

### Big pieces

| Piece | Files |
|---|---|
| Composer (input, send modes, keys dock, quick dock) | `components/composer.tsx` (1k lines) · `hooks/use-direct-typing.ts` · `hooks/use-key-queue.ts` + `components/key-queue-strip.tsx` · `components/quick-actions.tsx` · `lib/quick-replies.ts` |
| Send pipeline (what happens after tap) | `lib/reply-action.ts` (guard) · `lib/dialog-guard.ts` · `lib/prompt-action.ts` · `lib/preview-action.ts` · `lib/wizard-action.ts` · `lib/multi-select-action.ts` · `lib/menu-action.ts` · `lib/destructive.ts` (rm/dd/sudo confirm) · `lib/api.ts` |
| Screen → blocks → UI | `lib/ansi.ts` → `lib/blocks.ts` → `lib/harness/*` → `components/{prompt-select,preview-select,wizard,multi-select,menu}-block.tsx` · raw: `components/ansi-output.tsx` |
| Spaces tree (home) | `components/space-tree.tsx` · `lib/spaces.ts` (grouping/ordering) · `lib/triage.ts` (buckets) · `hooks/use-dash-prefs.ts` (persisted expansion) · `hooks/use-open-space.ts` |
| Agent cards / in-pane switcher | `components/agent-card.tsx` · `agent-sidebar.tsx` · `lib/triage.ts` (ordering) · `lib/status.ts` |
| Long-press actions | `hooks/use-long-press.ts` · `components/{pane,tab,space}-actions-sheet.tsx` · `action-sheet-rows.tsx` |
| Command palette / operator rows | `components/command-palette.tsx` · `lib/agent-commands.ts` · `lib/operator-commands.ts` |
| Push & notifications (client) | `lib/push.ts` · `lib/push-decision.ts` · `hooks/use-push.ts` · `hooks/use-notify-prefs.ts` · `components/{notify-prefs,snooze}-control.tsx` · `sw.ts` |
| Update banner / self-update | `lib/self-update.ts` · `lib/build.ts` · `lib/server-build.ts` · `components/update-banner.tsx` · `update-available-banner.tsx` · `update-check-control.tsx` · `build-stamp.tsx` |
| Connection health | `lib/connection.ts` · `lib/connection-health.ts` · `hooks/use-connection-lost.ts` · `hooks/use-online.ts` · `components/connection-banner.tsx` · `connection-info.tsx` |
| Drafts (survive reloads) | `lib/drafts.ts` · `hooks/use-terminal-draft.ts` · `components/terminal-draft-preview.tsx` |
| Idle lock | `lib/idle.ts` · `hooks/use-idle-lock.ts` · `components/idle-lock.tsx` |
| Theme / display prefs | `hooks/use-theme.ts` · `hooks/use-display-prefs.ts` (`rawTerminal` default **on**, key `v5`) · `hooks/use-dash-prefs.ts` · `components/theme-control.tsx` · `display-prefs.tsx` |
| Markdown in transcripts | `lib/markdown.ts` · `components/markdown-text.tsx` · `lib/links.ts` |
| Multi-session | `lib/session.ts` · `components/session-switcher.tsx` |
| PWA | `vite.config.ts` (`vite-plugin-pwa`) · `lib/pwa.ts` · `lib/sw-routes.ts` · `lib/reload-guard.ts` |

---

## 5. Three flows

**Poll & sync** — `herdr-client` `session.snapshot` → `state-engine` (interval) ◄ `event-poker` pokes on
agent status change → `server` `/api/snapshot` → `loaders.ts rootLoader` ◄ `use-polling` revalidates.

**Send** — tap prompt block / composer Send → `lib/dialog-guard.ts` verifies the prompt is still on
screen → `lib/api.ts` POST `/api/pane/:id/reply` with `expected_prompt` → `server.ts guard` (access
level) → `checkPromptBinding` (`pane.read` tail vs `expected_prompt`) → `audit.ts` line →
`herdr-client` `agent.send` / `pane.send_keys` → agent PTY. Long sends verified by the paste
placeholder ([ADR 0010](./.adr/0010-long-sends-are-verified-via-the-paste-placeholder.md)).

**History** — `/pane/:id/history` → `historyLoader` → GET `/api/pane/:id/history` → `paneHistory` →
`journal/registry.ts` picks the adapter by harness → adapter resolves the session file →
`files.ts containedRealpath` → parse → `TranscriptEntry[]` → `routes/history.tsx`. The pane also
stacks the newest journal turns above the live TUI (`use-inline-history.ts`) so sending does not
hide the session; the tail is never hidden. Grok has no Herdr session id: `inferFromCwd` matches
this pane's viewport when several grok tabs share a cwd (`journal/grok.ts`), rather than handing
every tab the newest session.

---

## 6. Change-impact matrix

| When you change… | Also open… | Leave alone |
|---|---|---|
| Herdr RPC / wire methods | `bridge/herdr-client.ts`, `bridge/wire.ts`, `bridge/types.ts`, `HERDR_API.md` | `web/src/`, `bridge/server.ts` |
| A harness's **screen** grammar | `web/src/lib/harness/<name>/`, `registry.ts`, `conformance.ts` fixtures, `lib/grammar/*_NOTES.md` | `bridge/` |
| A harness's **journal** adapter | `bridge/journal/<name>.ts`, `journal/registry.ts`; run `bun scripts/journal-probe.ts` | `web/src/lib/harness/` |
| Terminal rendering / colours | `web/src/components/ansi-output.tsx`, `lib/ansi.ts`, `index.css` ([ADR 0002](./.adr/0002-invert-the-light-terminal-mirror.md)) | `bridge/` |
| Display prefs / wrap / raw terminal | `web/src/hooks/use-display-prefs.ts`, `components/display-prefs.tsx`, `lib/blocks.ts` (`presentLine` noWrap: tables/chrome pan, prose wraps), composer ⚙ | `bridge/` |
| Auth / ingress / host & origin checks | `bridge/config.ts`, `bridge/server.ts` (`guard`, `checkAccess`, `isHostAllowed`), `DEPLOYMENT.md`, [ADR 0023](./.adr/0023-host-validation-is-fail-closed.md) | `web/src/lib/harness/` |
| Push / notifications | `bridge/notifications.ts`, `notify-prefs.ts`, `snooze.ts`, `push.ts`, `push-endpoint.ts`; `web/src/lib/push.ts`, `sw.ts`, `routes/settings.tsx`; README → Web Push | `state-engine.ts` internals |
| Update / release path | `bridge/update.ts`, `web/src/lib/self-update.ts`, `scripts/collie-ctl.sh update`, `contrib/windows/collie-ctl.ps1`, `herdr-plugin.toml` actions, `.github/workflows/release.yml` ([ADR 0006](./.adr/0006-update-advances-the-checkout-herdr-installed.md), [0019](./.adr/0019-update-pins-to-the-newest-release-tag.md), [0025](./.adr/0025-a-major-upgrade-is-consented-by-flag.md)) | — |
| Routes / navigation | `web/src/router.tsx`, `lib/loaders.ts`, `routes/`, `components/app-header.tsx`, `bottom-nav.tsx`, `lib/nav.ts` | `bridge/` |
| Operator rows (`commands.toml` / `keys.toml`) | `bridge/operator-commands.ts`, `bridge/operator-keys.ts`, `web/src/lib/{agent-commands,quick-replies,operator-commands,operator-keys,operator-scope}.ts`, `commands.toml.example`, `keys.toml.example` | — |
| SSSF traces | `bridge/sssf-viz.ts`, `web/src/components/sssf-frame.tsx`, `routes/traces.tsx` | `herdr-client.ts` |
| Windows control path | `contrib/windows/collie-ctl.ps1` (+ `.test.ps1`), generated `exec-bridge.vbs` in the plugin config dir, `contrib/windows/README.md`, `scripts/collie-ctl.sh` (the delegation) | — |
| Version / release | `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md` → `scripts/check-version.sh` | code |

---

## 7. Fast navigation — task → open these first

| Task | Open |
|---|---|
| Socket RPC bug | `bridge/herdr-client.ts` · `dial.ts` · `wire.ts` · `HERDR_API.md` |
| Polling / stale snapshot / transitions | `bridge/state-engine.ts` · `event-poker.ts` · `web/src/hooks/use-polling.ts` |
| Prompt / dialog not detected or mis-detected | First: composer ⚙ → Raw terminal **off**. Then `web/src/lib/blocks.ts` · `lib/harness/registry.ts` · `lib/harness/claude/` · `lib/grammar/*_NOTES.md` |
| Pane is raw TUI / no prompt buttons | `web/src/hooks/use-display-prefs.ts` · `components/display-prefs.tsx` · composer ⚙ |
| Send didn't land / wrong verification | `web/src/lib/reply-action.ts` · `dialog-guard.ts` · `bridge/server.ts sendReplySteps` · `checkPromptBinding` · `lib/harness/claude/paste.ts` |
| Composer / keys / type-into-terminal | `web/src/components/composer.tsx` · `hooks/use-direct-typing.ts` · `hooks/use-key-queue.ts` ([ADR 0005](./.adr/0005-a-composed-key-queue-never-outlives-its-dock.md)) |
| History empty / wrong | `bridge/journal/registry.ts` · `journal/<harness>.ts` (Grok: `inferFromCwd` in `journal/grok.ts`) · `journal/files.ts` · `web/src/routes/history.tsx` · `web/src/hooks/use-inline-history.ts` |
| Long-press rename / close | `web/src/hooks/use-long-press.ts` · `components/*-actions-sheet.tsx` · `action-sheet-rows.tsx` |
| Operator rows / Quick dock / palette | `bridge/operator-commands.ts` · `web/src/lib/{agent-commands,quick-replies,operator-commands}.ts` · `commands.toml.example` |
| Push not arriving / notification prefs | `bridge/notifications.ts` · `notify-prefs.ts` · `snooze.ts` · `push.ts` · `web/src/lib/push.ts` · `sw.ts` · `scripts/collie-ctl.sh push-test` |
| Update banner / update command | `bridge/update.ts` · `web/src/lib/self-update.ts` · `components/update-banner.tsx` · `contrib/windows/collie-ctl.ps1 update` · `web/src/lib/last-seen.ts` (cold-boot cache) |
| Image upload | `bridge/uploads.ts` · `server.ts uploadPane` · `web/src/components/composer.tsx` |
| "Connection lost" banner / offline | `web/src/lib/connection-health.ts` · `hooks/use-connection-lost.ts` · `components/connection-banner.tsx` |
| Draft lost / restored wrongly | `web/src/lib/drafts.ts` · `hooks/use-terminal-draft.ts` |
| Traces tab | `bridge/sssf-viz.ts` · `web/src/components/sssf-frame.tsx` · `routes/traces.tsx` |
| 403 / host / origin / access | `bridge/server.ts guard` · `checkAccess` · `isHostAllowed` · `bridge/config.ts` · `DEPLOYMENT.md` |
| Start / stop / restart / deploy | `scripts/collie-ctl.sh` · `contrib/windows/collie-ctl.ps1` (this box) · `justfile` · `herdr-plugin.toml` · `systemd/` |
| Add a new harness | [`HARNESS_CONTRIBUTING.md`](./HARNESS_CONTRIBUTING.md) first |
| Why was X decided | [`.adr/README.md`](./.adr/README.md) index |

Docs, by question: how to **run** it → `README.md` · how it's **built** → `ARCHITECTURE.md` · the
Herdr **wire contract** → `HERDR_API.md` · how to **deploy/expose** it → `DEPLOYMENT.md` · what
**changed** → `CHANGELOG.md` · where the **last session** stopped → `NEXT-SESSION.md`.
