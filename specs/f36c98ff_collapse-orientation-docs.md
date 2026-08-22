# Plan — collapse the orientation docs, make the README lead with install and use

Docs-only change. **No code change. No version bump.** Branch is already `chore/cleanup-3-docs`.

## The four moves

1. **Merge `CONTEXT.md` into `CLAUDE.md`, delete `CONTEXT.md`.** `CLAUDE.md` survives.
2. **Shrink `README.md`** — cut architecture/design detail `ARCHITECTURE.md` already carries, replace
   with links; move README-only design detail *into* `ARCHITECTURE.md`.
3. **Rewrite `NEXT-SESSION.md`** to current state only.
4. **Repoint every link to `CONTEXT.md`**, including `scripts/check-doc-links.sh`.

## Why `CLAUDE.md` survives, not `CONTEXT.md`

Not a coin flip — don't reverse it:

- Claude Code auto-loads `CLAUDE.md` as project instructions. A map in `CONTEXT.md` is only read if
  someone follows a link; a map in `CLAUDE.md` is read every session.
- Seven live source comments cite `CLAUDE.md` by section name (`bridge/journal/opencode.ts:19`,
  `web/src/lib/markdown.ts:5`, `web/src/lib/links.ts:4`, `web/src/lib/harness/conformance.ts:220`,
  `web/src/lib/harness/menu-hints.ts:49`, `web/src/lib/grammar/WIZARD_NOTES.md:101`,
  `scripts/check-version.sh:11`). Nothing cites `CONTEXT.md`.
- `.adr/README.md`, `ARCHITECTURE.md`, `CHANGELOG.md` and `README.md` all link `CLAUDE.md`. `.adr/`
  and `CHANGELOG.md` are out of scope to edit, so their links must stay valid — they do.

---

## 1. `CLAUDE.md` — the single orientation file

Target shape: **rules first, map second**, one file, roughly 520–540 lines.

### 1a. Header (replace lines 1–9)

- Title: `# CLAUDE.md — working agreement and system map for this repo`
- Keep the existing "**Collie** (repo `AltanS/collie`) — a phone web UI…" paragraph verbatim.
- In the "Orientation:" line, **delete** `[`CONTEXT.md`](./CONTEXT.md) (ICM system map) ·` and instead
  point at the in-file anchor, e.g. `the [system map](#system-map-icm) below`. Keep the
  `README.md` / `ARCHITECTURE.md` / `HERDR_API.md` / `.adr/` / `HARNESS_CONTRIBUTING.md` links.
- Carry over the **Windows-checkout blockquote** from `CONTEXT.md` lines 7–11 verbatim (this checkout
  runs on Windows, `collie-ctl.ps1`, Task Scheduler `wscript.exe` + `exec-bridge.vbs`,
  `build/collie-action-v1.exe`, "current version and session state: `NEXT-SESSION.md`"). Do **not**
  carry the sentence "**Rules** … live in `CLAUDE.md` — not restated here" — it now points at itself.
- Carry over the ICM form citation from `CONTEXT.md` line 5 (Van Clief & McDermott,
  `arXiv:2603.16021`) — put it on the `## System map (ICM)` heading below, not in the header.

### 1b. New `## Where to go` section, immediately after the header

Promote the last paragraph of `CONTEXT.md` (its §7 footer, "Docs, by question: …") to a short table
here. One row each: run it → `README.md` · how it's built → `ARCHITECTURE.md` · Herdr wire contract →
`HERDR_API.md` · deploy/expose → `DEPLOYMENT.md` · add a harness → `HARNESS_CONTRIBUTING.md` · why a
road wasn't taken → `.adr/README.md` · what changed → `CHANGELOG.md` · where the last session stopped
→ `NEXT-SESSION.md`.

### 1c. Rules half — keep verbatim

Keep these existing `CLAUDE.md` H2 sections **unchanged, in order, with their exact heading text**
(source comments and `.adr/` entries cite them by name — renaming any of them breaks a citation):

- `## Decision records — read before reopening a settled question`
- `## Versioning — MANDATORY`
- `## Build / run (operational facts that are easy to forget)`
- `## Frontend data layer (React Router, not TanStack)`
- `## Herdr socket gotchas (see HERDR_API.md for the full, verified contract)`
- `## The journal (scrollback the mirror can't give you)`
- `## Security posture (don't regress)`

Only edits allowed in this half: none, unless a link resolves to `CONTEXT.md` (none do).

### 1d. Map half — append after `## Security posture`

Add one heading:

```
## System map (ICM)

> Where things live, what talks to what, and which files to open for a task. Form: ICM System Map
> (Van Clief & McDermott, [arXiv:2603.16021](https://arxiv.org/abs/2603.16021)).
```

Then paste **all seven sections of `CONTEXT.md` verbatim**, demoting each `## N. …` to `### N. …`
(and its `### …` sub-headings to `#### …`), so the file keeps one H2 level for the map:

| From `CONTEXT.md` | Becomes |
| --- | --- |
| `## 1. Universes — what is live, what is not` (+ `### Names that collide`) | `### 1. …` (+ `#### Names that collide`) |
| `## 2. Shape — one picture` | `### 2. …` |
| `## 3. Bridge — every module, one line` (+ `### /api/* → handler`) | `### 3. …` (+ `#### …`) |
| `## 4. Web — folders, routes, and where the big pieces are` (+ 3 subs) | `### 4. …` (+ `#### …`) |
| `## 5. Three flows` | `### 5. …` |
| `## 6. Change-impact matrix` | `### 6. …` |
| `## 7. Fast navigation — task → open these first` | `### 7. …` |

Keep every table row. These tables are the map — do not summarise, do not drop columns.

Three text fixes inside the pasted map (they now point at their own file):

- §1 "live" row: `(`CLAUDE.md` → Versioning)` → `(→ [Versioning](#versioning--mandatory))`.
- §7 last row `| Why was X decided | [`.adr/README.md`](./.adr/README.md) index |` — keep as is.
- Drop the trailing "Docs, by question: …" paragraph (it became §1b above).

Also drop the `---` horizontal rules `CONTEXT.md` used between numbered sections if they read oddly
under an H3; keeping them is fine too.

### 1e. Delete `CONTEXT.md`

`git rm CONTEXT.md` (do not just empty it).

---

## 2. `README.md` — lead with install and use

**Target: ≤ 750 lines** (from 868). At least 100 lines shorter. Do **not** rewrite the voice —
these are named cuts, not a re-draft. Every heading in the keep list below stays, with its exact
anchor text, because the Contents list and in-page links depend on the anchors.

### Keep, untouched or near-untouched

`## ⚠️ Security — read before you run it` · `## Requirements` · `## Install` ·
`## First run — what you'll see` (with `### What just happened`, `### Open it on your phone`,
`### Is it actually working?`) · `## Configure` (with `### Files tab`, `### SSSF traces tab`,
`### Your own slash commands`, `### Your own quick replies`, `### Your own Keys presets`,
`### Multi-session`) · `## Commands` · `## Manage & update` (with `### Stop or uninstall`,
`### Update to a new release`, `### Surviving reboots`) · `## Troubleshooting`.

### The named cuts

**Cut 1 — `## Architecture` (currently ~lines 814–840, 27 lines → ~6).**
`ARCHITECTURE.md` §2 has the same box diagram with more detail, and §5 has the same four bullets.
Replace the whole section body with a short pointer, e.g.:

> A small Bun process sits between your phone and Herdr — the browser never touches the socket. The
> bridge binds loopback only, polls Herdr over a one-shot JSON-RPC socket, and serves the built PWA
> from disk. Diagram, the polling model, the two recovery loops and the security model:
> [`ARCHITECTURE.md`](./ARCHITECTURE.md).

Keep the sentence about [Variant C](./DEPLOYMENT.md#variant-c--reverse-proxy-as-the-only-front-door-no-tailscale)
only if it isn't already stated under Deployment variants; it is, so drop it.

**Cut 2 — `#### What `update` actually does to the checkout` (~lines 530–555, 26 lines → ~6). This
one MOVES, it does not vanish.**
Nothing in `ARCHITECTURE.md` covers the two checkout shapes. Add a new bullet to `ARCHITECTURE.md`
§5 (Architecture notes) titled something like **"Two checkout shapes, one update command"** carrying
the whole explanation: `herdr plugin install` leaves a detached shallow checkout with no branch, a
linked clone sits on a branch, `git symbolic-ref -q HEAD` is the one predicate, the tag-pin, why the
managed checkout is deliberately **not** re-linked, `--depth 1` only if already shallow, `--force`,
`COLLIE_UPDATE_REF`, and the ADR links ([0006], [0019], [0025]). Then leave in the README only the
operator-facing residue:

- linked clone → `git pull --ff-only` + re-link; managed install → newest release tag of your major;
- the by-hand line (`web/` → `collie-ctl.sh build`, live; `bridge/` → `systemctl --user restart collie`);
- `scripts/install-hooks.sh` once;
- "Why the two shapes differ: [`ARCHITECTURE.md`](./ARCHITECTURE.md) §5."

**Cut 3 — `## Deployment variants` (~lines 576–605, 31 lines → ~12).**
Keep the opening paragraph (loopback bind; what changes is what sits in front and how a request
proves who it is). Keep `### Variant A` with its three lines and the `COLLIE_TRUSTED_USER` snippet
and the two bullets (granularity; why serve is the trusted injector). Cut the "This is the right
choice unless…" paragraph down to one line and keep the four B–E links as a compact list.

**Cut 4 — `## Windows (experimental)` (~lines 606–634, 29 lines → ~16).**
`ARCHITECTURE.md` §5 "One protocol, two dialers" already carries the named-pipe / `bridge/dial.ts` /
`COLLIE_HERDR_DIAL=net` explanation. Cut the opening design paragraph and the closing
`COLLIE_HERDR_DIAL` paragraph; replace with one line: "Herdr on Windows exposes its control socket as
a named pipe, so Collie dials it through `node:net` — [`ARCHITECTURE.md`](./ARCHITECTURE.md) §5."
**Keep every operator bullet**: Task Scheduler + `contrib/windows/`, `collie-action-v1.exe` and the
WSL-stub warning, `*-posix` twins, `tailscale serve` not wired up → Variant C posture,
`COLLIE_MULTI_SESSION=off`, the `%APPDATA%\herdr\herdr.sock` default and `HERDR_SOCKET_PATH`, and the
`[events] stream up` check.

**Cut 5 — `## Demo` prose (~lines 54–65, 12 lines → ~5).** Keep the screenshot `<table>` untouched.
Compress the two paragraphs to: the home screen is one folder tree (space → tab → pane, a single
child opens straight through), agents needing you sort to the top, bottom bar = Spaces / Traces /
Settings with one back rule, a pane opens raw and ⚙ → Display → Raw terminal off gives tappable
prompt buttons, long-press a row to rename or close.

**Cut 6 — `## ⚠️ Security` defense bullets (~15 lines).** Keep all six "sharp edges" bullets and all
six "defenses" bullets — **every env var name and every operator action stays**. Trim only trailing
rationale sentences that `ARCHITECTURE.md` §6 already states, and make sure the bullet still ends
with `(details: [ARCHITECTURE.md §6](./ARCHITECTURE.md#6-security-model))`. The loopback-bind bullet
and the identity-gate bullet are where the duplication is. **If you cut a sentence that is not
already in `ARCHITECTURE.md`, put it in `ARCHITECTURE.md` §6 instead of deleting it.**

**Cut 7 — light trims (~25 lines total), prose only, no facts lost.** `### SSSF traces tab` (the
pane-attribution paragraph → 3 lines), `### Files tab` (one paragraph, not two), `## Web Push`
(the "Two behaviours worth knowing" paragraph → 2 lines), `### Is it actually working?` and
`### What just happened` (one redundant sentence each).

### After the cuts

- Update `## Contents` to match — remove the `Architecture` entry only if you removed the heading
  (you didn't; keep the heading, keep the entry).
- `## See also`: change `Ops, versioning & conventions — [`CLAUDE.md`](./CLAUDE.md)` to
  `Ops, versioning, conventions & the system map — [`CLAUDE.md`](./CLAUDE.md)`.
- `## Developing this plugin`: same one-word update to the `CLAUDE.md` sentence. Keep the section.
- Re-check every in-page anchor link still resolves (`#architecture`, `#first-run--what-youll-see`,
  `#troubleshooting`, `#windows-experimental`, `#multi-session`, `#web-push-optional`,
  `#%EF%B8%8F-security--read-before-you-run-it`). Don't rename a heading you didn't have to.

---

## 3. `ARCHITECTURE.md` — receives, never loses

Only two additions, both in §5 (Architecture notes), plus possible §6 additions from Cut 6:

- New bullet: **two checkout shapes, one `update`** (Cut 2 above). Put it after the "PWA
  cache-busting" bullet or at the end of §5 — it's release-path, not runtime.
- Its header blockquote (line 7) links `CLAUDE.md` — still valid. Optionally reword "for repo
  conventions" → "for repo conventions and the system map".
- Do **not** touch §8 (Future ideas) or the ADR links.

---

## 4. `NEXT-SESSION.md` — current state only

Rewrite it. Verified facts as of this session (re-check before writing):

- `main` is at **0.55.0**, tagged **v0.55.0** (`git describe --tags --abbrev=0`).
- **v0.52.2, v0.52.3 and v0.52.4 are now tagged** — `git tag -l` confirms. The current
  "## Next thing to do" item 1 telling the next session to tag them is **stale; delete it.**
- Open PRs: **#136** `chore/cleanup-2-litter` (stop tracking factory litter, drop shipped planning
  docs) — open. This work is the docs cleanup on branch `chore/cleanup-3-docs`, whose PR will follow.
  Re-run `gh pr list --state open` and write what you actually see.
- Bridge host: `C:\ClaudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`,
  `COLLIE_WORK_ROOT=C:\claudeos`, one listener on `:8787`.

Target shape (≤ ~55 lines):

```
# Next session
_one-line state stamp: main at 0.55.0 / v0.55.0, host, port_
## Where this stopped     (Files tab shipped; the two cleanup PRs)
## Resume with            (keep the existing command block, unchanged)
## Open                   (ONE list — no separate "Next thing to do")
## Watch out for          (≤ 10 bullets, box-specific only)
```

- **Delete the whole `## Next thing to do` section.** Its live items fold into `## Open`; item 1 is
  dead.
- `## Open` becomes exactly: the cleanup PRs, "Parked: send this fork's security fixes upstream to
  AltanS/collie", "Parked: Windows `push-keys` / `push-test` Herdr actions are POSIX-only".
- `## Resume with` — keep the command block verbatim, including the tests block and the
  `run_quality()` warning. It's still true and it's what makes a cold start work.
- `## Watch out for` — keep only the bullets that are about *this box* and not already permanent in
  `CLAUDE.md`: planner-is-Claude-Code-opus, `collie-ctl.ps1 status` false WARN, Herdr rejects
  duplicate action ids, PATH's `bash` is the WSL stub, the ACL/file-lock recovery + never
  `taskkill /IM bun.exe`, `/api/config` → `build` is what the phone runs, `run_quality()` publishes
  `web/dist`, `adws/adw_modules/` is protected, CI has no `uv`, don't `git merge upstream/main`.
  **Drop** the Files-tab, Grok-history, raw-terminal, wrap-toggle and "don't trust an ADW's success
  line" bullets — the first four are permanently written in `CLAUDE.md`.
- Last bullet becomes: "`CLAUDE.md` is the working agreement **and** the system map. `CONTEXT.md` is
  gone — don't recreate it. If `AGENTS.md` or `GEMINI.md` reappear, delete them."

---

## 5. Repoint every reference to `CONTEXT.md`

Confirmed live references (re-grep to be sure — exclude `.git/`, `node_modules/`, `web/dist`,
`adws/adw_data/sessions/`, `adws/adw_data/sssf.db*`):

| File:line | Action |
| --- | --- |
| `CLAUDE.md:7` | Replace with the in-file anchor (step 1a). |
| `scripts/check-doc-links.sh:17` | Remove `CONTEXT.md` from the default `files=(…)` array. |
| `scripts/git-hooks/pre-commit:20` | Remove `CONTEXT` from the staged-docs regex alternation. |
| `CONTEXT.md` | Deleted. |

Leave alone, deliberately:

- `CHANGELOG.md:213` — out of scope, and it's a historical entry describing a past release.
- `requests/*.md` and `specs/*.md` — historical records of what was asked for. They mention
  `CONTEXT.md` in prose, not as a markdown link, and `check-doc-links.sh` does not scan them.
- `adws/adw_data/sessions/**` — factory run logs, immutable.
- `adws/adw_data/prompt_engineering/builder/system.md:15` — mentions "repo-level CLAUDE.md git
  rules". Still true, no change. **Confirm by grep that nothing else under
  `adws/adw_data/prompt_engineering/` names either doc.**
- `.adr/README.md:53` and `.adr/0024`, `.adr/0025` — `.adr/` content is out of scope, and every one
  of those links points at `CLAUDE.md`, which survives.
- All seven source comments citing `CLAUDE.md` — valid as long as you don't rename a heading (1c).

---

## Verify

Run from the repo root, judge each by exit status:

```bash
scripts/check-doc-links.sh                 # must print ✓ and exit 0
bun run test                               # root suite: typecheck + bun test ./bridge ./scripts
cd web && bun run test && cd ..            # not strictly required (no web change) but cheap
grep -rn "CONTEXT\.md" --include=*.md --include=*.sh --include=*.ts . \
  | grep -v node_modules | grep -v /dist | grep -v adws/adw_data/sessions/ \
  | grep -v '^\./requests/' | grep -v '^\./specs/' | grep -v '^\./CHANGELOG.md'
                                           # must return nothing
wc -l README.md CLAUDE.md NEXT-SESSION.md  # README ≤ 750; CLAUDE.md ~520-540
test ! -f CONTEXT.md && echo "CONTEXT.md gone"
```

`scripts/check-doc-links.sh` with no arguments still exercises the whole entry-doc set, so it also
catches a broken link you introduced in `ARCHITECTURE.md` or `NEXT-SESSION.md`.

## Notes for whoever commits this

- **Docs-only: do not bump the version, do not add a CHANGELOG entry.** But
  `scripts/check-doc-links.sh` and `scripts/git-hooks/pre-commit` are under `scripts/`, which is a
  bump-trigger path in the pre-commit hook — so the commit needs the documented escape hatch:
  `SKIP_VERSION_CHECK=1 git commit …`. Say so in the PR description.
- `git rm CONTEXT.md` so the deletion is staged as a delete, not left as an untracked ghost.
- Branch `chore/cleanup-3-docs` already exists and sits on top of PR #136's commit; PR it against
  `main` after #136 merges, or note the dependency.
