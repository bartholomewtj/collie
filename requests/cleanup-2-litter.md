Stop tracking factory run litter and remove planning docs for work that has already shipped.

Where: `.gitignore`; `adws/adw_data/` (10 tracked files plus untracked `issue*-run.log`, `obs.log`, `pr-*-body.md`, `shot_tree.py`, `shot_tree.ts`, `shot-tree.ps1`); the stray untracked `web/adws/` and empty `web/specs/`; the tracked `requests/` (23 files), `specs/` (32), `app_docs/` (20) directories.

Done means:
- `.gitignore` ignores everything under `adws/adw_data/` EXCEPT `adws/adw_data/prompt_engineering/`, which stays tracked (the ADW config reads it). `git ls-files adws/adw_data` lists only `prompt_engineering` files.
- The untracked logs, pr bodies, shot_tree scripts, `web/adws/` and `web/specs/` are deleted from disk.
- `requests/`, `specs/` and `app_docs/` files are removed from the repo EXCEPT those for work still open: `requests/smart-wrap.md`, `requests/files-tab-resume.md`, `requests/files-tab-nav-assert.md`, `requests/cleanup-2-litter.md` (this file), `specs/6eefb81b_smart-wrap.md`, `specs/176b3281_files-nav-assertion.md`, and any spec for issue 69 (out-of-scope gate).
- No link in `README.md`, `CLAUDE.md`, `CONTEXT.md`, `ARCHITECTURE.md` or `DEPLOYMENT.md` points at a deleted file — `scripts/check-doc-links.sh` passes.
- `bun run test` passes.

Out of scope: anything under `adws/adw_data/sessions/` or `sssf.db*` (already ignored, leave on disk); editing `adws/adw_modules/`, `adws/adw_sssf_config/` or `adws/adw_*.py`; changing `CHANGELOG.md` or the version (no functional change); rewriting the docs beyond fixing dead links.
