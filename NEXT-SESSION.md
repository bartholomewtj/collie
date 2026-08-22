# Next session

_Main at **0.56.9** (`e48adfd` merge of #144), tagged **v0.56.9**; Windows host `C:\ClaudeOS\Projects\tools\collie`, Task Scheduler `herdr.collie`, `COLLIE_WORK_ROOT=C:\claudeos`, one listener on `:8787`. `web/dist` rebuilt on 0.56.9 (2026-08-22); bridge not restarted since (static files are served off disk, so no restart needed — phone must reopen the PWA)._

## Where this stopped

**0.56.9 (#144):** header `‹` now pops one history entry like swipe-back (`web/src/hooks/use-back.ts`, fallback target only on a cold entry); `web/src/lib/resume.ts` restores the last in-app path when Android relaunches the PWA at `/` after Open in browser (10 min window, fresh `navigate` only). The second fix is a best guess at the cause — **unverified on the phone**. If swipe-back after Open in browser still lands on the dashboard, next option is keeping the file inside the PWA window instead of a Chrome tab.


**Desktop mode phases 1 and 2 are done and merged** (#141 shell 0.56.0–0.56.2, #142 typing 0.56.3–0.56.7, #143 test follow-up 0.56.8). What exists now, all behind the Settings → Desktop mode toggle, phone untouched:

- Sidebar + pane shell, off-ramp strip, phone-only controls hidden, 2 h idle pause, `(n) Collie` tab title, Ctrl+Alt+Up/Down pane switch.
- Fixed layout: only the mirror and History scroll (spec §2a, added this session at Bart's request).
- Composer: Enter sends, Shift+Enter newline, empty-box Esc/Tab/arrow pass-through.
- Direct typing: click the mirror or Ctrl+` to arm; full keydown mapper (chords, F-keys, AltGr, IME, selection-aware Ctrl+C, "Herdr can't send …" notices); paste hold; image "Type path" chip; Ctrl+F find.
- README "Desktop mode" section incl. keys the browser keeps.

**Phases 3 and 4 are deliberately not started.** Spec §10: build them only if missed after a week of real desktop use. Phase 3 = right-click popover via `useLongPress` `disabled` + `{x,y}`, drag-and-drop upload. Phase 4 = number keys pick prompt options, History/Files width, README keys list. Requests for phases 1–2 are in `requests/desktop-*.md` as a pattern to copy.

**Not yet done by a human:** the manual checklist in #142's body (phone PWA unchanged after hard-refresh; Claude Code AskUserQuestion buttons; Pi ADW and Grok panes on both surfaces; vim in a shell; 3-line paste; AltGr on a non-US layout). Do that first next session and file anything wrong as an issue.

## Resume with

```bash
cd C:\claudeOS\Projects\tools\collie
git checkout main && git pull
git branch --show-current && git status --short      # expect main; untracked adws/adw_data/* is fine
git describe --tags --abbrev=0                        # expect v0.56.9
netstat -ano | findstr :8787                          # expect ONE listener
```

Do **not** rebuild just to clear the dist stamp. Rebuild only if a UI bug will not reproduce.
Phone must hard-refresh / reopen the PWA after a rebuild.

Tests: `bun run test` (root, 859) and `cd web && bun run test` (2,800+). ADW inner loop: `run_tests()` in
`adws/adw_modules/quality.py`. Do **not** run `run_quality()` casually — `build` rewrites live
`web/dist`. Factory tests (not `uv`, not `bun test`):

```bash
PYTHONPATH=adws python -m unittest adw_modules.test_out_of_scope adw_modules.test_permissions
```

## Running ADWs here — what this session learned

All chunks ran on `adw_simple_sdlc.py` (plan → build → test → review loop → commit → docs). 16 runs, ~$40.

- **Write the ask as `requests/<slug>.md`**, four lines (see `claudeSSSF/cookbooks/how_to_prompt_for_the_eng.md`). The `Out of scope:` line is a parsed deny-list: **every backticked path or directory on it is denied**, even inside a caveat like "only X in `foo.tsx`", and a directory denies everything under it. Three runs died this way (claudeSSSF #72). Put partial-scope caveats in the ask sentence, never on that line.
- **Bump a PATCH per chunk.** The pre-commit wants a version bump on every commit touching `web/src/` (tests included), so an ADW commit only lands if the request asks for a bump. Spec version numbers are a plan, not a rule.
- **Never commit on the branch while a run is live.** The reviewer's permission check diffs against the plan commit and its rollback does `git reset` — it deleted an operator commit once (recovered from reflog; noted on claudeSSSF #73).
- **Review loop**: `MAX_REVISION_LOOPS` is now 3 in `adws/adw_simple_sdlc.py` (was 2; claudeSSSF #73). With 3, two runs went fully end to end; the others still stalled one test nit short — the builder (gpt-5.6-luna, thinking medium) under-delivers the plan's test table (claudeSSSF #74). When that happens the product code is approved and green: hand-commit it and run a test-only follow-up request (pattern: `requests/desktop-1c-tests.md`, `desktop-2b-tests.md`, `desktop-2d-tests.md` — all landed).
- A run's `✗ fail` badge does not mean lost work; check `git status` and the session's `context_handoff/review.md` first.

## Open

- Manual checklist from #142 (above).
- #137: ADW commit phase fails on builder-staged deletions and on the version-bump pre-commit. Workaround in use: bump per chunk; hand-commit otherwise.
- #140: README harder cut (install / use / troubleshoot only). `adw_plan_build_test`.
- claudeSSSF: #72 deny-list parsing, #73 revision-loop bound (collie copy patched; upstream `adws/` and `templates/adws/` not), #74 builder thinking level, PR #71 cookbook note.
- Stale local remote refs for merged branches: `git fetch --prune`.
- Parked: send this fork's security fixes upstream to `AltanS/collie`.
- Parked: Windows `push-keys` / `push-test` Herdr actions are POSIX-only.

## Watch out for

- Planner is Claude Code **opus**; builder is pi/OpenRouter gpt-5.6-luna (the only metered seat); reviewer grok-4.6; scout/documenter agy gemini-3.7-flash.
- `collie-ctl.ps1 status` / `restart` warn "cannot reach Herdr yet" falsely; trust `[events] stream up` in `collie-ctl.ps1 logs`.
- `/api/config` returns 403 `identity required` from plain curl on the host; read `web/dist/build-info.json` for the served stamp instead.
- Herdr rejects duplicate action ids; canonical Windows actions use the exe and POSIX twins are `*-posix`.
- PATH's `bash` is the WSL stub; use Git Bash. Windows Herdr actions must not call `bash`. The `!` prefix in Claude Code runs Git Bash too — use `/c/...` paths there.
- If an ACL/file lock blocks recovery, grant the file with `icacls`, then start; never `taskkill /IM bun.exe`.
- `run_quality()` publishes `web/dist`; `run_tests()` does not build.
- `adws/adw_modules/` and `adws/adw_*.py` are protected from agents; CI has no `uv`.
- Do not `git merge upstream/main`.
- `CLAUDE.md` is the working agreement **and** the system map. `CONTEXT.md` is gone — don't recreate it. If `AGENTS.md` or `GEMINI.md` reappear, delete them.
