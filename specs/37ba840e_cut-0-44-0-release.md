# Plan — Cut Collie 0.44.0 (release commit for merged #77)

## What

Version-only release commit. #77 (idle panes hide the live TUI tail) is already merged into
`web/src`; this is the bump + CHANGELOG cut. **No tag, no push, no bridge restart** — the
engineer tags after merge. Minor bump (`0.43.2 → 0.44.0`) is correct: a new capability landed
(Added axis).

## Files to touch (exactly four)

1. **`herdr-plugin.toml`** — line 3: `version = "0.43.2"` → `version = "0.44.0"`.
2. **`package.json`** — top-level `"version": "0.43.2"` → `"0.44.0"` (first `"version"` key; leave any other version-ish keys alone).
3. **`web/package.json`** — same edit on its top-level `"version"`.
4. **`CHANGELOG.md`** — insert a new release block immediately **above** the existing
   `## [0.43.2] - 2026-08-20` heading (keep that heading and everything under it byte-identical;
   do not touch the 0.43.1 or 0.43.2 entries):

   ```markdown
   ## [0.44.0] - 2026-08-20

   ### Added
   - Idle panes hide the live terminal tail when the transcript already has the newest turn, so the thread reads as chat instead of a TUI snapshot. Show live still peels it back. (08db5c3)
   ```

   The Added line is quoted verbatim from the #77 PR body, citing short hash `08db5c3`, per the
   repo's CHANGELOG style (one line per change, hash at the end).

## Verification

- Run `scripts/check-version.sh` from the repo root — it **must print `✓`** (exit 0). It
  cross-checks all three version files plus the newest `CHANGELOG.md` heading.
- Confirm the newest heading is exactly `## [0.44.0] - 2026-08-20` and that the 0.43.2 block
  below it is intact.

## Out of scope (do not touch)

Tagging, pushing, `git` operations beyond nothing (C:\claudeos is not a repo; git lives in the
project repo and tagging is the engineer's job after merge), restarting the bridge, `adws/`,
`quality.py`, screenshots, `web/src` (merged in #77), `scripts/check-doc-links.test.ts` (already
fixed on this branch), the 0.43.1/0.43.2 CHANGELOG entries.

## Notes

- This is a functional-file bump (manifest + package.json files), so the version rule applies —
  but the *only* functional edits here are the version lines themselves; that is the release
  commit pattern CLAUDE.md describes (land features first, then cut the release).
- All three version edits are string replacements of `0.43.2` → `0.44.0` in the `"version"`
  field only — take care not to disturb other fields.
