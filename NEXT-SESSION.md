# Next session

_Last handoff: 2026-08-17 — branch `docs/handoff-2026-08-17` (main at 0.30.1)_

## Where this stopped

Fork of [AltanS/collie](https://github.com/AltanS/collie) (phone web UI that drives terminal AI
agents through a Herdr socket, served via `tailscale serve`). The 2026-08-16 security audit filed
12 issues on this fork; **9 are fixed and merged** (1, 2, 4, 5, 6, 7, 8, 9, 10), each by a
claudeSSSF `adw_simple_sdlc` run. Every fix has its own spec in `specs/`, write-up in `app_docs/`,
and ADR where a default changed (`.adr/0011`–`0013`). Nothing has been reported upstream.

Left when this session ended: #11 and #12 were still running through the driver, and #3 was
built + reviewer-approved but sitting unrebased on `fix/3-dns-rebinding-default`.

## Resume with

```bash
cd C:\claudeOS\Projects\collie
git checkout main && git pull
gh pr list; gh issue list                        # what #11 / #12 / #3 look like now
bun install --frozen-lockfile && bun test ./bridge/server.test.ts   # ~2 known Windows path fails
```

To watch or rerun the factory: `PORT=4601 just obs` (4600 is usually geneanalysis's visualizer),
`bash adws/drive_issues.sh 11 12` (run detached — see the script header).

## Next thing to do

1. **#11 / #12** — check `adws/adw_data/run_rest_summary.txt` and `gh pr list`. If a run failed
   with "nothing to commit", the work is still on the branch (agy commits it itself); push and
   `gh pr create --base main` by hand — that's what happened for #3, #6, #7, #10.
2. **#3** — `git checkout fix/3-dns-rebinding-default`, rebase onto main (conflicts in
   `bridge/server.ts` `checkAccess`, version files, `.adr/README.md` — ADR must become 0014).
   Decide on the `chore(release): 1.0.0` commit (planner's call: fail-closed Host is breaking);
   drop it for a 0.31.0 unless you want the fork to be 1.x. Then PR.
3. Decide whether to send any of #1–#12 upstream to AltanS/collie (parked, your call).

## Open

- Issues #3 (branch pushed, needs rebase + PR), #11, #12 (driver was running them)
- claudeSSSF issue #52 — agy builder hangs on its `schedule` tool and self-commits its work;
  both bit this project repeatedly. Fix belongs in the factory, not here.

## Watch out for

- **Merge PRs by retargeting to `main` first**, then merge, then delete the branch. Deleting a
  branch that another PR is based on auto-closes that PR (that's how #15 died; #18 replaced it).
- **Don't edit `adws/adw_sssf_config/sssf.config.yaml` while a run is going** — the builder's
  permission check sees a changed protected file and rolls it back (a planner-to-grok switch
  vanished this way and #6's build died with it).
- `bun test ./bridge` fails ~39 tests on Windows (POSIX paths, chmod, unix sockets). Judge by the
  tests you touched, or run in WSL for a clean bar.
- `sssf.db` shows sessions `30d5df7b`, `a45c9a59`, `41f3fa90`, `d14d25f7`, `028c3651`, `b1e8130a`
  as `running`/`fail` — killed or commit-phase-tripped runs whose work was harvested by hand.
- Roster (`sssf.config.yaml`): planner opus, builder/scout/documenter agy, reviewer grok-4.5. Each
  opus plan burns 3–5M tokens (~$2–4 notional); the Claude session limit hit once mid-run.
- `gh` default repo is this fork; `origin` = fork, `upstream` = AltanS/collie.
