# CLAUDE.md — working agreement for this repo

**Collie** (repo `AltanS/collie`) — a phone web UI for your Herdr agent herd, served over
Tailscale. A mobile-first PWA (Vite + React + TS + Tailwind v4 + shadcn) plus a Bun/TS bridge that
talks to Herdr's Unix socket, letting you monitor and reply to agents from a phone. The Herdr
plugin id is `herdr.collie` (manifest: `herdr-plugin.toml`). Orientation:
[`CONTEXT.md`](./CONTEXT.md) (ICM system map) · [`README.md`](./README.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) · verified API
[`HERDR_API.md`](./HERDR_API.md) · decisions [`.adr/`](./.adr/) · adding a harness
[`HARNESS_CONTRIBUTING.md`](./HARNESS_CONTRIBUTING.md).

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
Don't add a write route, an upload, or send-to-pane ([ADR 0026](./.adr/0026-the-files-tab-is-the-third-filesystem-reader.md)).

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
