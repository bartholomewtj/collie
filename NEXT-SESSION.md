# Next session

_Last handoff: 2026-08-17 — branch `chore/claudesssf-install`_

## Where this stopped

This is a fork of [AltanS/collie](https://github.com/AltanS/collie) (a phone web UI that drives
terminal AI agents through a Herdr socket, published via `tailscale serve`). A security audit of
upstream was done on 2026-08-16 and its 12 findings are filed as issues #1–#12 on **this fork**
(`bartholomewtj/collie`), ordered by severity. Nothing has been fixed yet and nothing has been
reported upstream. claudeSSSF is installed so the fixes can be run as ADWs; PR #13 carries that
install and is waiting for you to merge.

## Resume with

```bash
cd C:\claudeOS\Projects\collie
git checkout main && git pull            # after merging PR #13
bun install --frozen-lockfile && bun test ./bridge   # 547 pass / 39 fail on Windows — see below
just demo                                # claudeSSSF smoke test (or: uv run adws/adw_prompt.py "hi" --agent scout)
```

## Next thing to do

1. Merge PR #13 (claudeSSSF install) — https://github.com/bartholomewtj/collie/pull/13
2. Fix issue #1 (High: any `localhost` Origin bypasses the same-origin gate) — one clause in
   `bridge/server.ts:1141-1145` plus the test at `bridge/server.test.ts:92-99` that asserts the
   bug. Say "run adw_simple_sdlc on issue #1" and the orchestrator will drive it; branch + PR
   on this fork, you merge.
3. Decide whether to send #1 upstream to AltanS/collie (not sent yet — your call). Then work
   down #2–#7 (Medium) the same way.

## Open

- PR #13 — Install claudeSSSF factory — waiting on your review/merge (no CI on the fork)
- Issues #1 High CSRF via loopback Origin · #2 TRUSTED_USER fails open · #3 DNS rebinding default
  · #4 0.0.0.0 bind accepted · #5 `.env` sourced as shell · #6 unverified update · #7 push SSRF
  · #8–#12 Low hardening (read-level POSTs, upload MIME, error page leak, frontend, ops/CI)

## Watch out for

- **`bun test ./bridge` fails 39 tests on Windows** — all POSIX path assumptions (`/srv/...`,
  chmod, unix sockets). Upstream targets Linux/macOS; its CI is green. Don't chase these; judge
  fixes by the tests you touch, or run in WSL/a sandbox for a clean bar.
- `gh` default repo is now set to `bartholomewtj/collie`. Remotes: `origin` = fork,
  `upstream` = AltanS/collie. `gh issue`/`gh pr` without `--repo` used to hit upstream — that's why
  the handoff survey listed upstream's #91/#99/#105.
- claudeSSSF roster (`adws/adw_sssf_config/sssf.config.yaml`): planner=opus on Claude Code,
  builder/scout/documenter=agy (free Gemini quota), reviewer=grok. `.env` exists and is
  gitignored; `PYTHONUTF8=1` needed on Windows for the ADW scripts.
- The audit's full write-up lives only in the issues — there is no separate report file.
