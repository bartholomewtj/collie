# Plan — stale pidfile must match the full bridge path

Issue #12, item 3.

## What's wrong

`scripts/collie-ctl.sh` line 215, inside `stop_pidfile_process()`:

```sh
case "$(ps -p "$pid" -o command= 2>/dev/null)" in
  *bridge/index.ts*) kill -- "$pid" 2>/dev/null || true ;;
esac
```

The glob matches the **substring** `bridge/index.ts` anywhere in the command line. A pidfile
outlives its process (SIGKILL, panic, reboot) and the OS recycles pids, so on `start` this can
signal a bystander: another Collie checkout, a dev shell running `bun run
~/src/collie-fork/bridge/index.ts`, anything whose command line happens to contain that text.

The Windows script already gets this right —
`contrib/windows/collie-ctl.ps1:380-381` builds `Join-Path $script:PluginRoot "bridge\index.ts"`
and checks `CommandLine.Contains($bridgeScript)`.

## The fix

### 1. `scripts/collie-ctl.sh` (~line 215)

Match the full path of *this* checkout's entrypoint:

```sh
case "$(ps -p "$pid" -o command= 2>/dev/null)" in
  *"${PLUGIN_ROOT}/bridge/index.ts"*) kill -- "$pid" 2>/dev/null || true ;;
esac
```

Notes:

- The quotes around `${PLUGIN_ROOT}/bridge/index.ts` are load-bearing — they make it a literal, so a
  checkout path containing `*`, `?` or `[` can't turn into a wildcard. The bare `*` either side stay
  unquoted so they still glob.
- `PLUGIN_ROOT` is already an absolute, `cd`-resolved path (line 8), and the same expression is what
  the launchers write into the command line (lines 458, 552, 565, 569), so the two sides agree.
- Keep `kill -- "$pid" 2>/dev/null || true` exactly as is. Keep the surrounding comment; extend it
  by one line if you like to say *why* it's the full path.
- Nothing else in this file changes.

### 2. `scripts/collie-ctl.test.sh` — the existing test breaks, and must be updated

**This is not optional.** `test_launchd_agent_lifecycle` (around line 398) fakes the process table:

```sh
ps() {
  case " \$* " in
    *" 4242 "*) echo "/opt/homebrew/bin/bun run /x/bridge/index.ts" ;;
    *" 4243 "*) echo "/Applications/Something.app/Contents/MacOS/Something" ;;
  esac
}
```

The harness sources the real `collie-ctl.sh`, so after the fix `PLUGIN_ROOT` is the real repo root
and `/x/bridge/index.ts` no longer matches. Pid 4242 stops being killed and
`assert_eq "$(cat "$kill_calls")" '-- 4242'` fails. The pre-push hook runs this suite, so leaving it
red blocks the push.

The plan brief said "touch only `scripts/collie-ctl.sh`" — that was written without knowledge of
this fixture. Fixing the fixture is part of the same change; it is not scope creep.

Minimal edit — make 4242 look like the real checkout, and add a pid whose command line contains the
substring but belongs to a *different* checkout (the actual regression):

```sh
ps() {
  case " \$* " in
    *" 4242 "*) echo "/opt/homebrew/bin/bun run ${ROOT}/bridge/index.ts" ;;
    *" 4243 "*) echo "/Applications/Something.app/Contents/MacOS/Something" ;;
    *" 4244 "*) echo "/opt/homebrew/bin/bun run /elsewhere/collie/bridge/index.ts" ;;
  esac
}
```

The heredoc opener is unquoted `<<EOF`, so `${ROOT}` expands when the harness file is written — that
is what you want, and `ROOT` (test.sh line 30) is computed the same way as the ctl's `PLUGIN_ROOT`,
so they're the same string. Do **not** escape it as `\${ROOT}`; `PLUGIN_ROOT` isn't set in the outer
test script.

Then exercise 4244 next to the existing 4243 case, after the `cmd_start` / `cmd_stop` lines:

```sh
printf '4244\n' > "${CONFIG_DIR}/collie.pid"
stop_pidfile_process
[ -e "${CONFIG_DIR}/collie.pid" ] && exit 82
```

`assert_eq "$(cat "$kill_calls")" '-- 4242'` stays exactly as it is — that's the assertion proving
4243 and 4244 were spared. Update the comment above it to mention the foreign checkout.

### 3. Version bump (mandatory — `scripts/` is functional code)

Current version is `0.31.0` in all three files. This is a **PATCH**: the code now does what it was
always meant to do, and no operator has to change anything.

- `herdr-plugin.toml` → `version = "0.31.1"`
- `package.json` → `"version": "0.31.1"`
- `web/package.json` → `"version": "0.31.1"`
- `CHANGELOG.md` → new heading `## [0.31.1] - 2026-08-17` above `## [0.31.0]`, with:

```
### Fixed

- **A stale pidfile only kills this checkout's bridge** — the process-table check matched the bare
  substring `bridge/index.ts`, so a recycled pid running another checkout or a dev shell could be
  signalled on `start`; it now matches the full `${PLUGIN_ROOT}/bridge/index.ts` path, as the Windows
  script already did (#12, <short-hash>)
```

Land the code commit first, then cite its short hash in the CHANGELOG line and cut the release
commit — that's the house rule.

## Verify

Run each and judge it by exit status, not by words in the output:

1. `bash -n scripts/collie-ctl.sh` — syntax.
2. `bash -n scripts/collie-ctl.test.sh` — syntax of the fixture you edited.
3. `bash scripts/collie-ctl.test.sh` — the whole ctl lifecycle suite; `test_launchd_agent_lifecycle`
   must pass, exit 81/82 must not appear.
4. `bash scripts/check-version.sh` — must print `✓`.
5. `bun test` at the root — the rest of the backend suite; nothing here should be affected, it's the
   safety net.

No build and no service restart needed to review this — it's a shell script. On a deployment host the
new behaviour applies the next time an action invokes `collie-ctl.sh`.

## Out of scope

- Don't touch `contrib/windows/collie-ctl.ps1` — it already does the right thing.
- Don't change the launchers (lines 458/552/565/569) or the systemd/launchd paths.
- Don't rework `stop_pidfile_process` beyond the one `case` pattern — the pid validation, the
  `> 1` guard, and the unconditional `rm -f` of the pidfile all stay.

## Git

Branch `fix/12-pidfile-match` already exists and is checked out. Commit the code fix and the test
fixture together, then the `chore(release): 0.31.1` commit, then push and open a PR with `gh pr
create`. Push a `v0.31.1` annotated tag with it (`git push --follow-tags`) only if this is being
shipped as a release; if the maintainer is batching, leave the tag.

Ignore the untracked `adws/adw_data/run_rest_summary.txt` — don't commit it.
