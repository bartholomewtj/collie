# Next session

_Last handoff: 2026-08-18 — main at 0.32.0 (`b099df8`)_

## Where this stopped

Fork of [AltanS/collie](https://github.com/AltanS/collie) (phone web UI that drives terminal AI
agents through a Herdr socket, served via `tailscale serve`).

- **Security audit is done.** 11 of the 12 issues filed on 2026-08-16 are fixed and merged; each has
  a spec in `specs/`, a write-up in `app_docs/`, and an ADR where a default changed
  (`.adr/0019`–`0023`). Only #12 (low-priority ops hardening) is open.
- **Upstream is merged in** (PR #35): AltanS/collie 0.30.0 → 0.31.1 landed as fork **0.32.0**.
  Both repos had used `0.31.1` for different content, so the fork's version line now runs ahead;
  `CHANGELOG.md` keeps upstream's entries under their own heading.
- **ADRs renumbered** (PR #36): the fork's five ADRs moved from 0011–0014 to 0019–0023 so
  upstream's reserved `v1` block (0011–0016) can't collide.
- Nothing has been reported upstream.

## Resume with

```bash
cd C:\claudeOS\Projects\collie
git checkout main && git pull
git fetch upstream && git log --oneline HEAD..upstream/main    # anything new upstream?
bun install --frozen-lockfile && bun test ./bridge/server.test.ts
```

Clean test bar without WSL — run in a container (mount path must be Windows-style):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "C:\claudeOS\Projects\collie:/src:ro" oven/bun:1 bash -c \
  'cp -r /src /w && cd /w && rm -rf node_modules web/node_modules && bun install --frozen-lockfile >/dev/null; bun test bridge | tail -3'
```

For `scripts/collie-ctl.test.sh` in that container also `apt-get install -y git` and strip CRLF
first: `find scripts -name "*.sh" -exec sed -i "s/\r$//" {} +`.

## Next thing to do

1. **Pull upstream regularly** — `git fetch upstream`, then merge on a branch as in #35. Conflicts
   concentrate in `README.md`, `CHANGELOG.md`, `bridge/config.ts`, `.adr/README.md`. Keep the fork's
   fail-closed defaults; take upstream's docs structure.
2. **#12** — low-priority ops hardening (CI permissions/pins, systemd directives, pidfile match,
   Windows arg quoting). Small; could be a hand-written PR rather than a factory run.
3. Decide whether to send any of the security fixes upstream to AltanS/collie (parked, your call).

## Open

- Issue #12 only.
- claudeSSSF issue #52 — agy builder hangs on its `schedule` tool and self-commits; fix belongs in
  the factory, not here.

## Watch out for

- **Stacked PRs: retarget to `main` before merging the base PR**, then merge, then delete branches.
  Deleting a branch another PR targets auto-closes that PR (how #15 died; #18 replaced it).
- **Don't edit `adws/adw_sssf_config/sssf.config.yaml` while a run is going** — the builder's
  permission check sees a changed protected file and rolls it back.
- `bun test ./bridge` fails 34 tests on Windows (symlinks, chmod 0600, unix sockets) — same set on
  every branch. Judge by the tests you touched, or use the container above (752/752 on Linux).
- The Windows checkout is CRLF (autocrlf). Python `str.replace` scripts need `\r\n`; `sed -n` hides
  the `\r`. `bash scripts/*.sh` on Linux fails with `set: pipefail: invalid option` until stripped.
- `sssf.db` shows several old sessions as `running`/`fail` — killed runs whose work was harvested
  by hand. Not live.
- Roster (`sssf.config.yaml`): planner opus, builder/scout/documenter agy, reviewer grok-4.5.
- `gh` default repo is this fork; `origin` = fork, `upstream` = AltanS/collie.
