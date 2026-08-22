# CLAUDE.md — working agreement and system map for this repo

**Collie** (repo `AltanS/collie`) — a phone web UI for your Herdr agent herd, served over
Tailscale. A mobile-first PWA (Vite + React + TS + Tailwind v4 + shadcn) plus a Bun/TS bridge that
talks to Herdr's Unix socket, letting you monitor and reply to agents from a phone. The Herdr
plugin id is `herdr.collie` (manifest: `herdr-plugin.toml`). Orientation: the [system map](#system-map-icm)
below · [`README.md`](./README.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) · verified API
[`HERDR_API.md`](./HERDR_API.md) · decisions [`.adr/`](./.adr/) · adding a harness
[`HARNESS_CONTRIBUTING.md`](./HARNESS_CONTRIBUTING.md).

> **This checkout runs on Windows** (`C:\ClaudeOS\Projects	ools\collie`, fork of `AltanS/collie`, remote
> `bartholomewtj/collie`). Upstream and the docs assume Linux + systemd; on this box the bridge is
> started/stopped by `contrib/windows/collie-ctl.ps1` (Task Scheduler job is `wscript.exe` +
> `exec-bridge.vbs`, no console window). Herdr `update`/`restart`/`update-major` actions run
> `build/collie-action-v1.exe`. Current version and session state: [`NEXT-SESSION.md`](./NEXT-SESSION.md).

## Where to go

| Question | Start here |
|---|---|
| Run it | [`README.md`](./README.md) |
| How it is built | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Herdr wire contract | [`HERDR_API.md`](./HERDR_API.md) |
| Deploy / expose it | [`DEPLOYMENT.md`](./DEPLOYMENT.md) |
| Add a harness | [`HARNESS_CONTRIBUTING.md`](./HARNESS_CONTRIBUTING.md) |
| Why a road was not taken | [`.adr/README.md`](./.adr/README.md) |
| What changed | [`CHANGELOG.md`](./CHANGELOG.md) |
| Where the last session stopped | [`NEXT-SESSION.md`](./NEXT-SESSION.md) |

## Decision records — read before reopening a settled question

[`.adr/`](./.adr/) holds the decisions whose reasoning would otherwise live only in a PR thread —
specifically the ones that **close off an option someone will reasonably propose again**. If you're
about to argue *why not* rather than *how*, check there first; if the answer isn't there and the
decision is that shape, add one (numbering + format: [`.adr/README.md`](./.adr/README.md)).

Rules elsewhere in this file stay short and normative and link to the ADR for the argument. Don't
restate an ADR's reasoning here, and don't edit a superseded ADR into agreement with the present —
mark it superseded and write the next one.

## Versioning — MANDATORY

This plugin is **SemVer**ed, and the version is **enforced**, so it never silently drifts.

**The version lives in three files that must always agree, plus a matching CHANGELOG entry:**
`herdr-plugin.toml` (canonical — Herdr reads it) · `package.json` · `web/package.json` ·
newest `## [x.y.z]` heading in `CHANGELOG.md`.

**Before committing any functional change** (anything under `bridge/`, `web/src/`, `scripts/`, or the
manifest) you MUST:

1. **Bump** the version in all three files to the same number. The axis is **what the operator has
   to do**, not how visible the change is:
   - **PATCH** (`0.2.0 → 0.2.1`): the code now does what it was always meant to do — bug fixes and
     internal refactors. A fix may well change what you see; that alone never promotes it. When the
     correction is big enough that someone should read the notes, say so loudly in the CHANGELOG
     entry rather than inflating the bump.
   - **MINOR** (`0.2.0 → 0.3.0`): something is there that wasn't — a new capability, setting,
     surface, or action. Existing setups keep working untouched.
   - **MAJOR** (`0.2.0 → 1.0.0`): the operator must change something — a config key renamed or
     removed, a contract broken, a workflow that used to work and now doesn't.
2. **Add a `CHANGELOG.md` entry** under a new `## [x.y.z] - YYYY-MM-DD` heading (Added / Changed /
   Fixed). Use the real date. **Style: super crisp and short** — one line per change, no prose
   paragraphs, and cite the feature's short commit hash at the end of the line (`… (abc1234)`).
   Land features as their own commits first, then cut the release commit so the entry can cite them.
3. **Run `scripts/check-version.sh`** — it must print `✓`.

**A PR from a fork is the exception: leave all four files alone.** Bump nothing, add no CHANGELOG
entry — send the functional commits only. The version is the maintainer's to pick, because it depends
on what else lands in the same release and on which axis the *sum* of those changes sits; a bump
guessed at PR time collides with the `chore(release):` commit that actually cuts the release, and two
PRs both guessing `0.26.1` conflict with each other. `scripts/check-version.sh` stays green either
way — all four files simply keep the version they already agree on. The pre-commit hook may object
locally; `SKIP_VERSION_CHECK=1 git commit …` is the intended escape hatch here. If you'd like a
CHANGELOG line in your words, put it in the PR description and it'll be used. (Maintainer side: when
a fork PR does carry a release commit, cherry-pick the functional commits with `-x` and drop that one
— authorship is preserved and `main` stays unreleased until you cut it.)

Doc-only changes (`*.md`) don't need a bump. This is enforced two ways, but **you are the first
line — do it as part of the change, not after**:

- `scripts/check-version.sh` runs inside `scripts/collie-ctl.sh build` (a release can't build while
  versions disagree).
- A **git pre-commit hook** (`scripts/git-hooks/pre-commit`, activate once with
  `scripts/install-hooks.sh`) blocks commits where functional code changed but the version didn't.
  Escape hatch for a single commit: `SKIP_VERSION_CHECK=1 git commit …`.

**Tag the release when you push it.** Cutting a release means the three version files + the newest
`CHANGELOG.md` heading agree on `x.y.z` (steps 1–3). When that release lands on `main` and you push,
**always push a matching annotated git tag with it** — `git tag -a vX.Y.Z -m "Collie X.Y.Z" && git
push origin vX.Y.Z` (or `git push --follow-tags` so the tag ships *with* the release). One `v<x.y.z>`
tag per shipped version on the remote. Not hook-enforced — it's on you. (Adding/adjusting this note is
a doc-only change and needs no version bump.)

**Update notice (user-facing).** The app's in-app update banner links to the newest release's GitHub
page and shows the command to run. Pushing a `v*` tag auto-creates that GitHub Release (with the
commands) via `.github/workflows/release.yml`. **Always express user-facing update/restart
instructions as Herdr plugin actions** — `herdr plugin action invoke update --plugin herdr.collie`
(or `restart`) — never `collie-ctl.sh …` / `systemctl … collie`, which depend on the caller's cwd and
the unit name; the Herdr action runs from anywhere. On Windows those actions run
`build/collie-action-v1.exe` (PATH's bash is the WSL stub). Routine `update` stays inside the installed
major; crossing one is `herdr plugin action invoke update-major --plugin herdr.collie`
([ADR 0025](./.adr/0025-a-major-upgrade-is-consented-by-flag.md)).

## Build / run (operational facts that are easy to forget)

- **There are two checkout shapes, and `update` handles both.** `herdr plugin install` does not clone
  — it leaves a **detached, shallow** checkout that `update` pins to the newest `v*` tag **of the
  installed major** ([ADR 0019](./.adr/0019-update-pins-to-the-newest-release-tag.md),
  [ADR 0025](./.adr/0025-a-major-upgrade-is-consented-by-flag.md)), so `git pull` cannot run there;
  a linked clone sits on a branch and fast-forwards it. One predicate (`git symbolic-ref -q HEAD`)
  picks the strategy, and the same predicate stops `update` re-linking a managed checkout — a re-link
  re-registers the plugin as local and Herdr then refuses `herdr plugin install`, the operator's only
  other way to refresh ([ADR 0006](./.adr/0006-update-advances-the-checkout-herdr-installed.md)).
- **Frontend changes** (`web/`): rebuild with `bun run build` (root) or `cd web && bun run build`.
  The bridge serves `web/dist` **from disk at request time**, so on the deployment host
  a rebuild is **immediately live — no restart**. The corollary is the trap: **nothing rebuilds it
  for you**, so a correct checkout can serve a bundle built from something else and nothing errors.
  Since 0.42.0 the bridge checks for this itself (`bridge/build-freshness.ts`) — it warns at startup
  and on every flip, reports `staleBuild` on `/api/config`, and the phone's footer says
  "server needs `bun run build`". When a UI bug won't reproduce in the source, read the deployed
  build id off `/api/config` before reading any more code.
- **Backend changes** (`bridge/*.ts`): Bun does **not** hot-reload the service — you must
  `systemctl --user restart collie`. Forgetting this is the #1 "my change didn't take" trap.
- `bun run build` (root) and `collie-ctl.sh build` **typecheck both sides first** (root tsc + web
  tsc), then build web to `dist-staging` and swap it in atomically — a failed build never empties a
  live `web/dist`. Bare `cd web && bun run build` still skips typechecking; don't ship from it.
- **Tests:** frontend `cd web && bun run test` (Vitest + jsdom + Testing Library + MSW; no headless
  browser); backend `bun run test` at the root — Bun's own runner over every pure-logic module in
  `bridge/` (access checks, state engine, config, journal adapters, notifications, uploads, …) plus
  `scripts/collie-ctl.test.sh`, which exercises the ctl lifecycle in a sandboxed HOME.
  A **pre-push hook** (`scripts/git-hooks/pre-push`) runs **both** before
  every push — override once with `SKIP_TESTS=1 git push`. The bits that genuinely need `Bun.serve` /
  `Bun.connect` (HTTP handlers, the socket client) stay unit-untested — Vitest-on-Node can't run them,
  so keep new backend logic pure/injectable enough for `bun test`, or exercise it through `web/`.
- **Tests on Windows** (since 0.40.7) pass, so the hook needs no override there. Two POSIX facilities
  are missing and `bridge/platform-support.ts` is where that is written down: `POSIX_MODES` (no file
  mode bits — a file written 0600 reads back 0666) and `CAN_SYMLINK` (needs Developer Mode or
  elevation), the second **probed, not assumed**, so a box with Developer Mode on runs those tests
  like any other host. Nine tests assert one of the two and skip; nothing else gets a pass, and CI's
  skip count is unchanged. When a shared fixture is what needs the symlink, plant it conditionally so
  one `EPERM` doesn't take the whole file down with it.
- **The lifecycle suite is per-platform, because the lifecycle is.** `bash scripts/collie-ctl.test.sh`
  refuses to run on Windows: `collie-ctl.sh` delegates every verb to `contrib/windows/collie-ctl.ps1`
  there, so the suite would leave its sandbox and drive the real Task Scheduler job and the real port —
  it can stop the bridge it is testing. The hook runs `contrib/windows/collie-ctl.test.ps1` in its
  place (scheduler cmdlets stubbed, registers nothing); CI is Linux and always takes the bash branch.
- **Build fixture paths with `join()`, never by interpolating `/`.** 25 backend tests once looked
  green on Windows while asserting nothing: their fake filesystems keyed on `${root}/sessions/…`
  strings the code under test never produced, and `resolveStaticPath`'s fixture root was rejected by
  its own containment check. A test that can't match its subject fails silently, not loudly.
- Service: `systemd --user` unit `collie` on the deployment host; logs `journalctl --user -u collie -f`.
- **Dependencies must be 7 days old to install** (`bunfig.toml` + `web/bunfig.toml`, mirrored in
  `.npmrc` for npm users) — a compromised release is usually pulled within hours. A brand-new
  version resolving to an older one is the rule working, not a bug; CI's `--frozen-lockfile` is
  unaffected.
- TS is strict on both sides, with `noUnusedLocals/Parameters` everywhere. **`web/` additionally**
  enforces `verbatimModuleSyntax` + `erasableSyntaxOnly` (use `import type`, no parameter-property
  shorthand there). The **bridge** tsconfig does not enable those two — bridge code uses
  parameter-property shorthand by convention; keep each side consistent with itself.

## Frontend data layer (React Router, not TanStack)

- Data flows through **React Router** (`createBrowserRouter`, data mode): route **loaders**
  (`web/src/lib/loaders.ts`) fetch the snapshot + pane; **polling is `useRevalidator()` on an
  adaptive interval** (`web/src/hooks/use-polling.ts`); mutations are direct `lib/api.ts` calls
  followed by `revalidator.revalidate()`. There is **no TanStack Query** — don't reintroduce it.
- Routes (`web/src/router.tsx`): `/` (the Spaces tree), `/traces`, `/traces/:spaceId/:repo`,
  `/settings`, `/pane/:paneId` and `/pane/:paneId/history`. `/spaces` and `/space/:spaceId` are
  kept as **redirects to `/`** (`routes/redirects.tsx`) — old bookmarks, push deep links and a PWA's
  saved start URL still resolve; `/space/:spaceId` expands that space in the tree on the way past.
  The router instance is module-scoped so it keeps its location.
- **Home is ONE tree, not a dashboard plus a navigator.** `/` renders `components/space-tree.tsx`:
  space → tab → pane, where **a row with exactly one child opens that child instead of expanding**
  (same rule at every level, so a one-tab/one-pane space is one tap to the CLI). Triage lives on the
  rows — a status dot per row, blocked spaces first and auto-expanded unless you explicitly collapsed
  them. Expansion is persisted in `use-dash-prefs.ts`, not in the URL. Don't reintroduce a separate
  "who needs me" screen or a per-space route; 0.40.8 removed both because they said the same thing
  twice.
- **Navigation is a bottom bar + one back rule.** `BottomNav` (Spaces / Traces / Settings) is
  mounted in `routes/root.tsx` and shown on those three destinations only; every screen below one
  passes `AppHeader onBack` — a "‹" that goes up exactly one level (pane → tree, trace → Traces,
  history → pane). Don't add a second way back (a Back chip in a strip, the Collie mark as home) or
  a sibling-switcher row on a pushed screen; that's the mess 0.35.0 removed.
- **Tap-and-hold is the one way to manage a pane, tab or space in place.** Pane pills and all three
  row kinds in the home tree (space, tab, pane) open a small actions sheet on a hold
  (`use-long-press.ts` + `*-actions-sheet.tsx`, rows shared via `action-sheet-rows.tsx`). Rename +
  close for panes and tabs; **rename only for spaces** — Collie never deletes a space. Don't add a
  second gesture (swipe-to-delete, an ⋯ button) or a second sheet; extend the existing one, and keep
  the hold's phone rules from the hook's header (`select-none`, no `touch-action: none`).
- **The idle lock pauses; it does not gate.** It only appears when Collie is left *open, visible and
  untouched* — a hidden page never locks, and returning to the foreground auto-resumes. It covers a
  still-mounted router (unmounting it ate in-progress composer drafts) and pauses polling through
  `lib/idle.ts`. Don't restore it as a security control or re-describe it as one
  ([ADR 0007](./.adr/0007-the-idle-lock-is-a-pause-not-a-gate.md)).
- **"Type into terminal" is armed by a named choice and dies with the pane view.** It is the "Type"
  toggle in the Controls row beside Keys — never a gesture on Send, and never a bare long-press. It
  disarms on a pane switch, a composer lock (gone pane, read-only, idle pause), a hidden page, and a
  failed batch — never persisted, never restored. Don't lift it, and don't add the reply guard's
  `composerReady` pre-flight to it; the reasoning for the entry point sits at the toggle in
  `web/src/components/composer.tsx`, and for the pre-flight in `web/src/hooks/use-direct-typing.ts`.
- **The operator's rows in `commands.toml` replace the shipped command catalog on the panes they
  address, never merge into it** ([ADR 0018](./.adr/0018-operator-command-rows-replace-the-catalog.md));
  the bridge re-reads the file behind an mtime check, so edits are live and need no restart. The
  file's `[[quick]]` rows do the same to the Quick dock's shipped replies (shells excepted).
  `keys.toml` does the same for the Keys tray's Presets catalog (`bridge/operator-keys.ts`).
- **PWA** via `vite-plugin-pwa` (`web/vite.config.ts`): manifest + `sw.js`, registered manually
  from `virtual:pwa-register` in `main.tsx` (bundled = CSP-safe). Install/SW need a **secure
  context** — over plain HTTP they no-op silently (Chrome insecure-origin flag, or HTTPS, to test).
- **The bundled Nerd Font subsets stay lazy and out of the precache** — `unicode-range` per face,
  version in the filename, cached first-use by `sw.ts`. Don't add them to `globPatterns`, don't
  widen a range, don't move subsetting into the build; the reasoning for each sits at the line that
  would change (`web/src/index.css`, `web/vite.config.ts`, `scripts/build-nerd-font.sh`).

## Herdr socket gotchas (see HERDR_API.md for the full, verified contract)

- RPC is **one-shot**: one request per connection; the server closes after one reply. `id` must be
  a **string**. Only `events.subscribe` streams.
- `pane.send_keys` grammar is **`+`-joined, not tmux**: `ctrl+c` (NOT `C-c`), `shift+tab`, `Up`,
  `Tab`, `Escape`, `Enter`, `Backspace`. `PageUp`/`Home`/`End`/`Delete` are unsupported.
- **A long send to Claude is verified via its paste placeholder** — anything past Claude's paste
  threshold collapses in the input box to `[Pasted text #N +M lines]`; the guard accepts that token as
  send evidence only when it is consistent with the message just typed. Don't try to dodge the
  threshold by chunking sends ([ADR 0010](./.adr/0010-long-sends-are-verified-via-the-paste-placeholder.md)).
- **A password prompt is recognised so Collie can SAY what it is, never so it can send** — no
  automatic Enter, no relaxed verification, no secret channel; the remedy offered is the operator's
  own tap on "Type" ([ADR 0017](./.adr/0017-recognising-a-password-prompt-changes-what-collie-says.md)).
  Recognition does one thing on its own: it drops the stored draft and stops persisting keystrokes.
- Pane output is rendered as **React text nodes** (never `innerHTML`); the ANSI parser only derives
  colors/weights. Keep it that way — it's the XSS boundary. Strict CSP + same-origin gate stay.
- **Collie runs no terminal emulator** — `pane.read` returns Herdr's already-rendered grid, so the
  parser needs colour and nothing else. Don't add one on either side, and don't reach for
  `terminal session observe`/`control`: a stale mirror is a transport problem, cursor position is an
  upstream ask, and `control` resizes the *shared* PTY
  ([ADR 0008](./.adr/0008-collie-does-not-run-a-terminal-emulator.md)).
- **Never use a `dark:` variant inside the mirror `<pre>`** — it tracks the root theme, which is
  backwards in a surface that renders dark under every theme and inverts in light
  ([ADR 0002](./.adr/0002-invert-the-light-terminal-mirror.md)). Fails silently;
  `ansi-output.test.tsx` guards it.
- **The plan dialog's last row is a text input, and it is never a button** — its label is only a
  placeholder while the box is empty, and its digit merely focuses the field. While `❯` sits on it the
  terminal swallows every digit as a character, so no button on that dialog may be pressable; while it
  holds text, Collie must not type into it (the caret resets to position 0, so it would prepend). A
  long value **wraps** the row rather than windowing it, which re-flows the screen above — so nothing
  may read that row as one line, and no mid-flight identity may reach above the question.
  Feedback is sent as a verified sequence, never a keystroke — the ground truth for every state is
  [`PLAN_FEEDBACK_NOTES.md`](./web/src/lib/grammar/PLAN_FEEDBACK_NOTES.md); re-walk it before touching
  `harness/claude/prompt-select.ts` or `lib/prompt-action.ts`.
- **A generically-detected menu emits only the keys the screen printed** — the footer's
  `<key> to <verb>` hints plus the arrows it advertised. Never synthesise a digit from a numbered row:
  in the `/model` picker a digit confirms *and* persists the user's default. The generic grammar
  (`harness/claude/menu.ts`) runs LAST, after every specific detector declines, and an unrecognised
  modal refuses composer typing via the adapter's `composerReady` pre-flight
  ([ADR 0009](./.adr/0009-a-generic-menu-is-driven-by-the-keys-it-names.md)).
- **A composed key queue never outlives its dock** — closing Keys discards it (guarded by a two-tap
  confirm on the drawer transition, not the ✕). Don't lift or persist it: a queue surviving into a
  later open would let Send fire a stale sequence into a pane that has moved on
  ([ADR 0005](./.adr/0005-a-composed-key-queue-never-outlives-its-dock.md)).
- **The statusline-run bound in `chrome.ts` guards less than it looks** — a dialog below the box is
  refused by the border/prompt checks and by the blank line Claude paints above its footer hint, never
  by the row count. Size it up if a real statusline needs more rows; don't delete it, and don't credit
  it with protection it doesn't provide
  ([ADR 0004](./.adr/0004-the-statusline-run-is-bounded.md)). `chrome.test.ts` pins both halves.

## The journal (scrollback the mirror can't give you)

`bridge/journal/` reads the agent's own session log off disk, per harness (`claude` / `codex` / `pi` /
`grok` / `opencode`, registered in `registry.ts`). It, `bridge/sssf-viz.ts` (the SSSF traces tab,
[ADR 0024](./.adr/0024-the-sssf-module-is-the-second-filesystem-reader.md)), and
`bridge/workdir.ts` (the opt-in Files tab, [ADR 0026](./.adr/0026-the-files-tab-is-the-third-filesystem-reader.md))
are the **only** things in the bridge that touch the filesystem, so the containment rule in
[`files.ts`](./bridge/journal/files.ts) is absolute: **every** path an
adapter is about to read goes through `containedRealpath` — after symlink resolution, on the real
paths, including paths derived from one already checked. The client never supplies a path. Run
`bun scripts/journal-probe.ts` against real logs after touching an adapter; unit tests pin the
grammar, the probe catches on-disk format drift.

**The Files tab is read-only and opt-in.** `bridge/workdir.ts` serves one directory named by
`COLLIE_WORK_ROOT`; unset means the routes don't exist and the tab doesn't show. Every path is parsed
to relative segments, refused against the skip list, and contained with `containedRealpath` after
symlink resolution — a typed path at `.env` 404s like an absent file. Downloads are always `attachment`.
Open-in-browser is `GET /api/files/open` for an allowlisted set Chrome can display (PDF, images,
audio, video, a few text types, HTML). Always `nosniff`. HTML is `text/html` plus
`Content-Security-Policy: sandbox` (unique origin, no scripts) — never `allow-same-origin` or
`allow-scripts`. Never SVG/XML/JS. Image/audio/video preview in the Files tab with
`<img>`/`<audio>`/`<video>` against that URL; don't iframe PDF (flaky on iOS) or HTML (new-tab
sandbox only). Don't add a write route, an upload, or send-to-pane
([ADR 0026](./.adr/0026-the-files-tab-is-the-third-filesystem-reader.md),
[ADR 0027](./.adr/0027-html-open-is-a-unique-origin-sandbox.md)).

## Security posture (don't regress)

Loopback bind only · exactly one hardened front door — `tailscale serve` (never `funnel`) or a
conforming reverse proxy per DEPLOYMENT.md Variant C (`COLLIE_SKIP_SERVE=1`) · same-origin gate ·
optional identity/device gates · strict CSP. A socket call can type into a real terminal — treat the bridge as
remote shell access.

**Collie manages exactly one front door: `tailscale serve`** — `collie-ctl.sh` publishes it, records
the mapping in `tailscale-managed-handler`, and only ever tears down a mapping matching that record.
Every other tunnel (NetBird, ZeroTier, Cloudflare Tunnel) is `COLLIE_SKIP_SERVE=1` + DEPLOYMENT.md
Variant E: the operator owns the ingress, Collie publishes nothing. **Don't add a second managed front
door** — [ADR 0001](./.adr/0001-one-managed-front-door.md).

**Push subscribe, snooze and notification prefs (POST) are write-level** — bridge-wide state a read-only device must not be able to set; endpoint validation and caps in `push-endpoint.ts` still close the SSRF ([ADR 0021](./.adr/0021-notification-settings-are-writes.md), which supersedes 0020). `GET …/prefs` and `POST /api/update/check` stay read-level.

**Host validation is fail-closed** — a non-loopback Host must be loopback, a `COLLIE_PUBLIC_HOSTS`
entry, a ctl-discovered Tailscale host, or an allowed origin's host
([ADR 0023](./.adr/0023-host-validation-is-fail-closed.md)).

## System map (ICM)

> Where things live, what talks to what, and which files to open for a task. Form: ICM System Map
> (Van Clief & McDermott, [arXiv:2603.16021](https://arxiv.org/abs/2603.16021)).

## 1. Universes — what is live, what is not

| Universe | Where | Rule |
|---|---|---|
| **live** | `bridge/` (Bun backend) · `web/src/` (Vite + React frontend) · `scripts/` · `herdr-plugin.toml` · `.adr/` · `contrib/windows/` (**live on this box** — the ctl bash script delegates `start/stop/restart/update` to `collie-ctl.ps1` on Git Bash) | Active code. Functional changes need a version bump (→ [Versioning](#versioning--mandatory)) and pass `bun test`. |
| **factory** | `adws/` — claudeSSSF agent-workflow scripts (Python, `uv`) that *operate on* this repo. `adws/adw_data/sssf.db` is what the Traces tab reads. | Not app code. Don't edit `adws/adw_sssf_config/sssf.config.yaml` mid-run. |
| **historical** | `specs/`, `requests/` — the plan and request artefacts those factory runs produced for work that is still open. | Read for background on *why a change was made*; never the source of truth for how the code works now. |
| **ghost** | Ideas parked in [`ARCHITECTURE.md` §8](./ARCHITECTURE.md) — `herdr terminal session observe`/`control`, a client-side terminal emulator, speech APIs. | **Do not implement.** Closed by ADRs ([0008](./.adr/0008-collie-does-not-run-a-terminal-emulator.md)). |
| **generated / vendored** | `web/dist`, `web/dist-staging`, `build/`, `node_modules/`, `web/src/components/ui/` (shadcn — regenerate, don't hand-edit) | Don't edit by hand. |

#### Names that collide

- **Herdr workspace vs Collie space** — same thing. Herdr `workspace_id` ↔ a space row in the home tree (there is no per-space route any more; `/space/:spaceId` redirects to `/`). A space holds tabs; a tab holds panes.
- **Herdr pane vs agent chat** — Herdr's `pane_id` is a raw PTY. Collie defaults to that raw mirror (`use-display-prefs`, `rawTerminal: true`, storage `collie:display-prefs:v5`). Turn **Raw terminal** off in Display settings (composer ⚙) to get `AgentChat` prompt parsing. Bare shells always stay on the raw mirror.
- **Raw terminal** — a persisted display pref, **on by default**. Not the same as **Type into terminal** (the send-mode toggle beside Keys).
- **Session** means three things: the agent's on-disk transcript id (`bridge/journal/`), Herdr's daemon session (`session.snapshot`), and Collie's multi-session URL `?s=<name>` (`web/src/lib/session.ts`, `bridge/sessions.ts`).
- **Idle lock** — a pause, not a security gate (`web/src/lib/idle.ts`, [ADR 0007](./.adr/0007-the-idle-lock-is-a-pause-not-a-gate.md)).
- **Type into terminal** — a per-session send mode armed by the "Type" toggle beside Keys; never persisted. Entry point + reasoning at the toggle in `web/src/components/composer.tsx`; the keystroke pump in `web/src/hooks/use-direct-typing.ts`. (Older docs cite a `send-mode-menu.tsx` — it no longer exists.)
- **SSSF** = Super Simple Software Factory (the `adws/` universe above). Its trace visualiser is an external Vue app that Collie mounts in an iframe at `/sssf/*` from `SSSF_VIZ_DIR` (`bridge/sssf-viz.ts`, [ADR 0024](./.adr/0024-the-sssf-module-is-the-second-filesystem-reader.md)).
- **Harness** — a CLI agent Collie can drive (`claude`, `codex`, `pi`, `grok`, `omp`, `opencode`). Two independent adapter sets share the word: **screen grammar** in `web/src/lib/harness/<name>/` (parses the live pane) and **journal adapters** in `bridge/journal/<name>.ts` (read the log on disk). Adding one: [`HARNESS_CONTRIBUTING.md`](./HARNESS_CONTRIBUTING.md).

---

### 2. Shape — one picture

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
   ├─ sssf-viz.ts (Traces iframe — filesystem reader #2)
   └─ workdir.ts (Files tab — filesystem reader #3)
        │
        │ HTTP: loaders.ts (React Router data mode) + api.ts mutations + use-polling.ts revalidate
        ▼
 web/src/  routes/ → components/ → lib/harness (screen grammar → Block AST) → blocks rendered
                                    lib/ansi.ts → components/ansi-output.tsx (mirror, text nodes only)
```

---

### 3. Bridge — every module, one line

`bridge/` is small enough to list in full. Tests sit beside each file as `*.test.ts`.

| File | Role |
|---|---|
| `index.ts` | Entry point. Loads config, starts state engine, event poker, notifications, push, server. Periodic journal rescan lives here. |
| `config.ts` | All env → `Config`, resolved once. Loopback-bind check (`isLoopbackBindHost`), `COLLIE_*` parsing, allowed origins/hosts, trusted user, device header. |
| `server.ts` | Composition root: builds helpers, Bun.serve dispatch, and re-exports the public helper surface. |
| `responses.ts` | Shared response builders, CSP, hardening headers, and JSON-body checks. |
| `access.ts` | Access and device gates, peer checks, seen tracking, and startup warnings. |
| `static-assets.ts` | Static PWA serving, build IDs, cache rules, and reserved auth path. |
| `pane-read-routes.ts` | Pane mirror reads and journal history routes. |
| `pane-write-routes.ts` | Reply, keys, upload, close, rename, and prompt binding. |
| `tree-routes.ts` | Tab and workspace create, rename, and close routes. |
| `notify-routes.ts` | Push subscription, snooze, notification preferences, and update checks. |
| `snapshot-route.ts` | Snapshot and bridge configuration routes. |
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
| `workdir.ts` | Read-only browser of `COLLIE_WORK_ROOT` — list, name search, preview, download, open in browser. Filesystem reader #3. |
| `journal/registry.ts` | The single decision site for "which agents have readable history"; maps harness → adapter. |
| `journal/files.ts` | Filesystem half shared by adapters. **`containedRealpath` is the containment invariant** — every path any adapter reads goes through it. |
| `journal/store.ts` | Reads + caches parsed journals for whichever adapter the pane's agent selects. |
| `journal/text.ts` | Shared caps so one pathological log can't balloon a response. |
| `journal/types.ts` | `TranscriptEntry` and the adapter contract. |
| `journal/{claude,codex,pi,grok,opencode}.ts` | One adapter per harness — finds the session file, parses it. Probe real logs with `bun scripts/journal-probe.ts`. |

#### `/api/*` → handler (route-group modules under `bridge/`)

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
| `/api/files` · `/api/files/search` · `/api/files/download` · `/api/files/open` | GET | `workdir.ts` | read |
| `/sssf/*` | GET | `sssfViz.handle` | read |
| `/auth`, `/auth/*` | — | reserved placeholder (`isReservedAuthPath`) | — |
| everything else | GET | `serveStatic` from `web/dist` | read |

---

### 4. Web — folders, routes, and where the big pieces are

`web/src/` is ~180 files; this lists the folders and the files you'll actually open. Tests sit beside
each file as `*.test.ts(x)`.

#### Folders

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

#### Route → file

| Path | File | Loader |
|---|---|---|
| `/` (Spaces tree) | `routes/tree.tsx` → `components/space-tree.tsx` | `rootLoader` (`/api/snapshot`, on the layout) |
| `/spaces` → `/` | `routes/redirects.tsx` (`SpacesRedirect`) | — |
| `/space/:spaceId` → `/` | `routes/redirects.tsx` (`SpaceRedirect`) — expands that space first | — |
| `/traces` · `/traces/:spaceId/:repo` | `routes/traces.tsx` → `components/sssf-frame.tsx` | — |
| `/files` · `/files/*` | `routes/files.tsx` | `filesLoader` |
| `/settings` | `routes/settings.tsx` | — |
| `/pane/:paneId` | **`routes/detail.tsx`** → `components/agent-chat.tsx` + `composer.tsx` | `paneLoader` |
| `/pane/:paneId/history` | `routes/history.tsx` → `components/transcript-view.tsx` | `historyLoader` |

Router: `router.tsx` (module-scoped, keeps location). Loaders: `lib/loaders.ts`. Polling: `hooks/use-polling.ts` → `useRevalidator()`. Mutations: `lib/api.ts` then revalidate. **React Router v7, package `react-router`** (not `react-router-dom`); no TanStack Query.

#### Big pieces

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

### 5. Three flows

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

### 6. Change-impact matrix

| When you change… | Also open… | Leave alone |
|---|---|---|
| Herdr RPC / wire methods | `bridge/herdr-client.ts`, `bridge/wire.ts`, `bridge/types.ts`, `HERDR_API.md` | `web/src/`, `bridge/server.ts` |
| A harness's **screen** grammar | `web/src/lib/harness/<name>/`, `registry.ts`, `conformance.ts` fixtures, `lib/grammar/*_NOTES.md` | `bridge/` |
| A harness's **journal** adapter | `bridge/journal/<name>.ts`, `journal/registry.ts`; run `bun scripts/journal-probe.ts` | `web/src/lib/harness/` |
| Terminal rendering / colours | `web/src/components/ansi-output.tsx`, `lib/ansi.ts`, `index.css` ([ADR 0002](./.adr/0002-invert-the-light-terminal-mirror.md)) | `bridge/` |
| Display prefs / raw terminal | `web/src/hooks/use-display-prefs.ts`, `components/display-prefs.tsx`, composer ⚙ | `bridge/` |
| Auth / ingress / host & origin checks | `bridge/config.ts`, `bridge/server.ts` (`guard`, `checkAccess`, `isHostAllowed`), `DEPLOYMENT.md`, [ADR 0023](./.adr/0023-host-validation-is-fail-closed.md) | `web/src/lib/harness/` |
| Push / notifications | `bridge/notifications.ts`, `notify-prefs.ts`, `snooze.ts`, `push.ts`, `push-endpoint.ts`; `web/src/lib/push.ts`, `sw.ts`, `routes/settings.tsx`; README → Web Push | `state-engine.ts` internals |
| Update / release path | `bridge/update.ts`, `web/src/lib/self-update.ts`, `scripts/collie-ctl.sh update`, `contrib/windows/collie-ctl.ps1`, `herdr-plugin.toml` actions, `.github/workflows/release.yml` ([ADR 0006](./.adr/0006-update-advances-the-checkout-herdr-installed.md), [0019](./.adr/0019-update-pins-to-the-newest-release-tag.md), [0025](./.adr/0025-a-major-upgrade-is-consented-by-flag.md)) | — |
| Routes / navigation | `web/src/router.tsx`, `lib/loaders.ts`, `routes/`, `components/app-header.tsx`, `bottom-nav.tsx`, `lib/nav.ts` | `bridge/` |
| Operator rows (`commands.toml` / `keys.toml`) | `bridge/operator-commands.ts`, `bridge/operator-keys.ts`, `web/src/lib/{agent-commands,quick-replies,operator-commands,operator-keys,operator-scope}.ts`, `commands.toml.example`, `keys.toml.example` | — |
| SSSF traces | `bridge/sssf-viz.ts`, `web/src/components/sssf-frame.tsx`, `routes/traces.tsx` | `herdr-client.ts` |
| Windows control path | `contrib/windows/collie-ctl.ps1` (+ `.test.ps1`), generated `exec-bridge.vbs` in the plugin config dir, `contrib/windows/README.md`, `scripts/collie-ctl.sh` (the delegation) | — |
| Version / release | `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md` → `scripts/check-version.sh` | code |

---

### 7. Fast navigation — task → open these first

| Task | Open |
|---|---|
| Socket RPC bug | `bridge/herdr-client.ts` · `dial.ts` · `wire.ts` · `HERDR_API.md` |
| Polling / stale snapshot / transitions | `bridge/state-engine.ts` · `event-poker.ts` · `web/src/hooks/use-polling.ts` |
| Prompt / dialog not detected or mis-detected | First: composer ⚙ → Raw terminal **off**. Then `web/src/lib/blocks.ts` · `lib/harness/registry.ts` · `lib/harness/claude/` · `lib/grammar/*_NOTES.md` |
| Pane is raw TUI / no prompt buttons | `web/src/hooks/use-display-prefs.ts` · `components/display-prefs.tsx` · composer ⚙ |
| Send didn't land / wrong verification | `web/src/lib/reply-action.ts` · `dialog-guard.ts` · `bridge/pane-write-routes.ts sendReplySteps` · `checkPromptBinding` · `lib/harness/claude/paste.ts` |
| Composer / keys / type-into-terminal | `web/src/components/composer.tsx` · `hooks/use-direct-typing.ts` · `hooks/use-key-queue.ts` ([ADR 0005](./.adr/0005-a-composed-key-queue-never-outlives-its-dock.md)) |
| History empty / wrong | `bridge/journal/registry.ts` · `journal/<harness>.ts` (Grok: `inferFromCwd` in `journal/grok.ts`) · `journal/files.ts` · `web/src/routes/history.tsx` · `web/src/hooks/use-inline-history.ts` |
| Long-press rename / close | `web/src/hooks/use-long-press.ts` · `components/*-actions-sheet.tsx` · `action-sheet-rows.tsx` |
| Operator rows / Quick dock / palette | `bridge/operator-commands.ts` · `web/src/lib/{agent-commands,quick-replies,operator-commands}.ts` · `commands.toml.example` |
| Push not arriving / notification prefs | `bridge/notifications.ts` · `notify-prefs.ts` · `snooze.ts` · `push.ts` · `web/src/lib/push.ts` · `sw.ts` · `scripts/collie-ctl.sh push-test` |
| Update banner / update command | `bridge/update.ts` · `web/src/lib/self-update.ts` · `components/update-banner.tsx` · `contrib/windows/collie-ctl.ps1 update` · `web/src/lib/last-seen.ts` (cold-boot cache) |
| Image upload | `bridge/uploads.ts` · `bridge/pane-write-routes.ts uploadPane` · `web/src/components/composer.tsx` |
| "Connection lost" banner / offline | `web/src/lib/connection-health.ts` · `hooks/use-connection-lost.ts` · `components/connection-banner.tsx` |
| Draft lost / restored wrongly | `web/src/lib/drafts.ts` · `hooks/use-terminal-draft.ts` |
| Traces tab | `bridge/sssf-viz.ts` · `web/src/components/sssf-frame.tsx` · `routes/traces.tsx` |
| Files tab | `bridge/workdir.ts` · `web/src/routes/files.tsx` · `web/src/lib/nav.ts` |
| 403 / host / origin / access | `bridge/access.ts guard` · `checkAccess` · `isHostAllowed` · `bridge/config.ts` · `DEPLOYMENT.md` |
| Start / stop / restart / deploy | `scripts/collie-ctl.sh` · `contrib/windows/collie-ctl.ps1` (this box) · `justfile` · `herdr-plugin.toml` · `systemd/` |
| Add a new harness | [`HARNESS_CONTRIBUTING.md`](./HARNESS_CONTRIBUTING.md) first |
| Why was X decided | [`.adr/README.md`](./.adr/README.md) index |
