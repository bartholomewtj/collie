Collapse the repo's top-level orientation docs so there is one place to start, and make the README lead with install and use.

Where: `CLAUDE.md` (289 lines) and `CONTEXT.md` (257 lines) overlap — merge them into one orientation file; `README.md` (868 lines); `ARCHITECTURE.md`; `NEXT-SESSION.md`; `scripts/check-doc-links.sh`.

Done means:
- One of `CLAUDE.md` / `CONTEXT.md` survives as the single orientation file, holding everything the two said that is still true (working agreement, versioning rules, ICM system map, where-to-go table). The other is deleted and every link to it across the repo (`*.md`, `.adr/`, `adws/adw_data/prompt_engineering/`) is repointed.
- `README.md` keeps Security, Requirements, Install, First run, Configure, Commands, Manage & update, Troubleshooting. Architecture and design detail that `ARCHITECTURE.md` already covers is removed from the README and replaced by a link; anything only the README said moves into `ARCHITECTURE.md`. Target is the README noticeably shorter, not a rewrite of its voice.
- `NEXT-SESSION.md` states only the current state: main at the current version, the cleanup PRs, and no stale "next thing to do" items.
- `scripts/check-doc-links.sh` passes; `bun run test` passes.

Out of scope: `CHANGELOG.md`, `.adr/` content, `HERDR_API.md`, `HARNESS_CONTRIBUTING.md`, `DEPLOYMENT.md`; any code change; any version bump (docs only).
