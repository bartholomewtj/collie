# Cut Collie 0.44.0 Release

## Summary

Bumped Collie version from `0.43.2` to `0.44.0` across the canonical plugin manifest and package definitions, and added the corresponding `0.44.0` entry to `CHANGELOG.md` for merged PR #77 ("Idle panes hide the live terminal tail when the transcript already has the newest turn, so the thread reads as chat instead of a TUI snapshot. Show live still peels it back.").

## Changes

- `herdr-plugin.toml`: Updated plugin `version` from `0.43.2` to `0.44.0`.
- `package.json`: Updated root project `version` from `0.43.2` to `0.44.0`.
- `web/package.json`: Updated frontend package `version` from `0.43.2` to `0.44.0`.
- `CHANGELOG.md`: Added release block for `[0.44.0] - 2026-08-20` under `Added` citing commit `08db5c3`, while leaving previous release sections intact.
- `specs/37ba840e_cut-0-44-0-release.md`: Added release task plan.

## Verification

Run version consistency check:
```bash
scripts/check-version.sh
```
The script verifies that `herdr-plugin.toml`, `package.json`, `web/package.json`, and the latest heading in `CHANGELOG.md` all agree on `0.44.0` and prints `✓`.
