# Plan — stop tracking factory litter, delete shipped planning docs

**Branch:** `chore/cleanup-2-litter` (already checked out). **Request:** `requests/cleanup-2-litter.md`.

This is a housekeeping change. Nothing functional moves: no `bridge/`, no `web/src/`, no `scripts/`,
no manifest. **Do not bump the version and do not touch `CHANGELOG.md`** — the pre-commit hook's
bump rule only fires on those functional paths, so it will stay quiet.

---

## What is actually on disk right now (verified)

- `adws/adw_data/` — **10 tracked files, all under `prompt_engineering/`** (5 agents × `system.md` +
  `user.md`). Everything else in there is untracked: 34 `*.log` files, 4 `pr-*-body.md`, 3
  `shot_tree` / `shot-tree` scripts, plus `sessions/` and `sssf.db*` (already ignored, **stay**).
  Because the only tracked files are the keepers, **no `git rm --cached` is needed here** — the
  `.gitignore` edit alone finishes the job.
- `web/adws/` — a stray empty tree (`web/adws/adw_data/sessions/4396573c/context_handoff`), no files.
- `web/specs/` — empty directory.
- `requests/` — 23 tracked files (all shipped). The 4 keepers named in the request
  (`smart-wrap.md`, `files-tab-resume.md`, `files-tab-nav-assert.md`, `cleanup-2-litter.md`) are
  currently **untracked**.
- `specs/` — 32 tracked; 2 keepers (`6eefb81b_smart-wrap.md`, `176b3281_files-nav-assertion.md`) →
  **30 to delete**.
- `app_docs/` — 20 tracked, **all delete**. No keeper is named for this directory.
- **There is no spec for issue 69.** `gh issue list` returns `[]` (no open issues) and nothing in
  `specs/` mentions it. That clause of the request is vacuous — don't go hunting.

## Baselines measured before planning (on this Windows box)

- `bun run test` → **839 pass, 20 skip, 0 fail**, exit 0. (`collie-ctl.test.sh` prints
  "skipped on Windows" and exits 0 — that is correct, not a failure.)
- `bash scripts/check-doc-links.sh` → `✓ doc links resolve`, exit 0.

Both must still be true at the end.

---

## Change 1 — `.gitignore`: ignore all of `adws/adw_data/` except the prompt files

Replace these two lines in the `# sssf runtime` block at the bottom:

```
adws/adw_data/sessions/
adws/adw_data/sssf.db*
```

with:

```
# sssf runtime — the factory's data dir is scratch: session traces, run logs, PR bodies, one-off
# scripts, the trace db. Only the prompt files the ADW config reads
# (adws/adw_sssf_config/sssf.config.yaml points at them) are tracked.
adws/adw_data/*
!adws/adw_data/prompt_engineering/
```

Leave the `__pycache__/` and `*.pyc` lines below it alone, and leave the rest of the file alone.

**Why this exact pair of patterns:** `adws/adw_data/*` (with the star) ignores the *contents*, not
the directory, so git still descends into it and the `!` re-include for `prompt_engineering/` takes
effect. `adws/adw_data/` without the star would make the re-include impossible. This was tested in a
scratch repo: with these two lines, `git add -A` tracks only
`adws/adw_data/prompt_engineering/planner/system.md`, and `check-ignore` reports `obs.log`,
`sessions/x/f.md`, `sssf.db` and `shot_tree.py` all ignored. The two lines being replaced become
redundant — the new pattern covers `sessions/` and `sssf.db*`.

## Change 2 — delete the untracked litter from disk

Run these from the repo root. **Use these exact globs. Never `rm -rf adws/adw_data/*`** — the
factory run you are inside lives at `adws/adw_data/sessions/ba8f8ec1/`, and `sessions/` and
`sssf.db*` are explicitly out of scope and must survive.

```bash
rm -f adws/adw_data/*.log
rm -f adws/adw_data/pr-*-body.md
rm -f adws/adw_data/shot_tree.py adws/adw_data/shot_tree.ts adws/adw_data/shot-tree.ps1
rm -rf web/adws
rmdir web/specs
```

After this, `ls adws/adw_data` must show exactly: `prompt_engineering`, `sessions`, `sssf.db`,
`sssf.db-shm`, `sssf.db-wal`.

## Change 3 — remove the shipped planning docs from the repo

Use `git rm`, not `rm` — these are tracked. Use an explicit, filtered list, **not `git rm specs/*`**:
`specs/` also holds the two keepers and this plan's own copy
(`specs/ba8f8ec1_untrack-factory-litter.md`, untracked when you start), and a blanket glob would
take them.

```bash
# all 23 tracked requests (every keeper is untracked, so this list is exactly the shipped ones)
git rm -q $(git ls-files requests)

# all 20 app_docs
git rm -q $(git ls-files app_docs)

# 30 specs — everything tracked except the two keepers
git rm -q $(git ls-files specs | grep -v -e '6eefb81b_smart-wrap.md' -e '176b3281_files-nav-assertion.md')
```

Then **stage the four keeper request files**, which are currently untracked:

```bash
git add requests/smart-wrap.md requests/files-tab-resume.md requests/files-tab-nav-assert.md requests/cleanup-2-litter.md
```

Why: `scripts/check-doc-links.sh` requires the backticked `requests/` path in `CONTEXT.md` to point
at something that exists. If the keepers stay untracked, the directory is absent in a fresh clone and
the gate fails there even though it passes on your machine. Committing them also matches the
request's own framing — they are the files "for work still open", i.e. work the repo should carry.

## Change 4 — fix the one dead doc link (`CONTEXT.md`, line 22)

Deleting every `app_docs/` file removes the directory (git doesn't track empty dirs), and
`check-doc-links.sh` matches backticked paths beginning `app_docs/`. The `**historical**` row of the
Universes table in `CONTEXT.md` currently reads:

```
| **historical** | `specs/`, `requests/`, `app_docs/` — the plan/request/doc artefacts those factory runs produced, one file per issue. | Read for background on *why a change was made*; never the source of truth for how the code works now. |
```

Replace that row with:

```
| **historical** | `specs/` and `requests/` — the plan and request files for work that is still open. A shipped run's artefacts are deleted once the change lands; the commit and its CHANGELOG line are the durable record. | Read for background on *why a change was made*; never the source of truth for how the code works now. |
```

That is the whole doc edit. **Do not rewrite anything else in `CONTEXT.md`** or in the other entry
docs — rewriting docs beyond fixing dead links is out of scope. Do not add an `app_docs/.gitkeep` to
dodge this: a placeholder file kept alive to preserve an empty directory is the same kind of litter
this change removes, and the run's documenter recreates `app_docs/` on its own when it writes.

No other entry doc needs touching — `README.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`,
`NEXT-SESSION.md`, `HARNESS_CONTRIBUTING.md`, `HERDR_API.md` and `.adr/README.md` were all grepped and
none of them name `specs/`, `requests/` or `app_docs/`.

---

## Verify (all must pass)

```bash
git ls-files adws/adw_data                 # → only the 10 prompt_engineering files
git check-ignore -v adws/adw_data/obs.log  # → matched by adws/adw_data/*
git check-ignore adws/adw_data/prompt_engineering/planner/system.md; echo $?   # → 1 (NOT ignored)
ls adws/adw_data                           # → prompt_engineering sessions sssf.db sssf.db-shm sssf.db-wal
ls web/adws web/specs                      # → both "No such file or directory"
git ls-files specs                         # → exactly the 2 keepers
git ls-files requests                      # → exactly the 4 keepers (after the git add)
git ls-files app_docs                      # → empty
bash scripts/check-doc-links.sh            # → ✓ doc links resolve
bun run test                               # → 839 pass, 20 skip, 0 fail (unchanged)
```

`git status` should then show: modified `.gitignore` and `CONTEXT.md`, 73 deletions, 4 additions
(the keeper requests), plus the untracked plan copy in `specs/`.

## Traps

- **Don't delete `adws/adw_data/sessions/`.** This run is writing into it. Same for `sssf.db*` — the
  Traces tab reads that database and `bridge/sssf-viz.test.ts` builds its own copy in a temp dir.
- **Don't touch `adws/adw_modules/`, `adws/adw_sssf_config/` or `adws/adw_*.py`.** The config's
  `prompt_engineering` paths are exactly why those 10 files stay tracked; nothing there needs editing.
- **No version bump, no CHANGELOG entry.** Nothing functional changed. The hook only demands a bump
  for `bridge/ web/src/ web/public/ web/vite.config.ts web/index.html web/package.json scripts/
  systemd/ package.json herdr-plugin.toml`.
- The hook **does** run `check-doc-links.sh` when `CONTEXT.md` is staged, so Change 4 is not optional.
- `git ls-files` is the only reliable way to tell tracked from untracked here — `git status` hides
  the 34 run logs because `*.log` is already ignored repo-wide.
