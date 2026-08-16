# Plan — Issue #5: parse `.env` instead of sourcing it, and lock down its permissions

## Note on the request file

`requests/issue-5-env-parse-not-source.md` did not exist when this plan was written. The source of
truth used here is GitHub issue #5 (`gh issue view 5`), title *"Medium: collie-ctl.sh sources .env as
shell; .env perms never enforced"*. Step 0 below writes the missing request file so the record
matches `requests/issue-1-loopback-origin.md`.

## The problem

`scripts/collie-ctl.sh:42`:

```bash
if [ -f "${CONFIG_DIR}/.env" ]; then set -a; . "${CONFIG_DIR}/.env"; set +a; fi
```

Three separate faults:

1. **The `.env` is executed, not read.** Anything that can write
   `~/.config/herdr/plugins/config/herdr.collie/.env` gets arbitrary code execution as the operator
   on every `start` / `stop` / `status` / `update` / `build`, and on macOS at every login (launchd
   runs `collie-ctl.sh _exec-bridge`). A config file is data; running it is a privilege boundary the
   script gives away for free.
2. **`set -a` exports everything to every child.** `COLLIE_VAPID_PRIVATE` — the Web Push signing key
   — reaches `git`, `tailscale`, `herdr`, `bun install`, `bunx tsc` and everything they spawn. Only
   the bridge process (and `push-test`) needs it. The comment at lines 83-97 guards one symptom of
   the same root cause (a `bun()` function defined in `.env` poisoning `PATH`), and `self_dnsname`
   (line 177) still pipes into a **bare** `bun`, so that guard is incomplete anyway.
3. **The "mode 600" claim is fiction.** Line 370 asserts `.env` is mode 600 and the launchd plist
   relies on that claim to justify keeping secrets out of the world-readable plist. Nothing ever
   sets the mode. `.env.example:2` tells the operator to `cp` with no `chmod`, and the three
   `mkdir -p "$CONFIG_DIR"` calls (lines 333, 376, 438) use the default umask. On the common umask
   022 the VAPID private key lands world-readable.

`contrib/windows/collie-ctl.ps1:46-63` (`Import-CollieEnv`) already does this correctly — it
regex-parses `KEY=value`. The bash side should read the same grammar.

## What we're building

1. A `.env` **parser** in bash (no `source`, no `eval`), matching `Import-CollieEnv`'s grammar.
2. Parsed values land as **plain shell variables, not exported**. The script reads them exactly as
   it does today (`${COLLIE_PORT:-8787}` works on a non-exported variable). Only the bridge launch
   paths and `push-test` export them.
3. `chmod 700` on the config dir and `chmod 600` on `.env` on the start path, with a warning when
   the mode was wider than that.
4. `self_dnsname`'s bare `bun` becomes `"$BUN"`.

## Files to touch

| File | Change |
| --- | --- |
| `requests/issue-5-env-parse-not-source.md` | **new** — the missing request record (step 0) |
| `scripts/collie-ctl.sh` | the parser, the scoped export, the perm hardening, `"$BUN"` at line 177, comment fixes at 83-97 and 370 |
| `scripts/collie-ctl.test.sh` | new tests; update the stale rationale comment on `test_non_absolute_bun_never_reaches_path` |
| `.env.example` | add `chmod 600` to the copy instruction at the top |
| `README.md` | add `chmod 600` to the `cp .env.example …` block near line 337 |

Do **not** touch `herdr-plugin.toml`, `package.json`, `web/package.json` or `CHANGELOG.md` — see
*Versioning* at the bottom.

## Step 0 — write the missing request file

`requests/issue-5-env-parse-not-source.md`, same one-paragraph-per-line shape as
`requests/issue-1-loopback-origin.md`: what to fix, where (file + line numbers), what done means,
what is out of scope.

## Step 1 — the parser (`scripts/collie-ctl.sh`, replacing line 42)

Replace the `set -a; . …; set +a` line with a function defined just above it. Constraints:

- **Bash 3.2 must work** — macOS ships it. No `declare -A`, no `declare -g`, no `${var,,}`.
- **No `eval`.** Assign with `printf -v "$key" '%s' "$value"` (bash 3.1+). The key is validated
  first, so the name passed to `printf -v` is always `[A-Za-z_][A-Za-z0-9_]*`.
- **No regex operator needed.** Validate the key with `case` globs, which behave identically on 3.2:
  `case "$key" in ''|[0-9]*|*[!A-Za-z0-9_]*) …invalid… ;; esac`.
- The function must run at top level so its assignments are global. Declare only its own scratch
  variables `local`; never `local` the parsed key.

Grammar (deliberately the same as `Import-CollieEnv`):

- Strip a trailing `\r` from each line — `.env` files edited on Windows are real, and today's
  `source` chokes on them too.
- Skip blank lines and lines whose first non-blank character is `#`.
- Trim leading/trailing whitespace on the line; trim whitespace around the key; trim trailing
  whitespace on the value.
- Accept an optional leading `export ` prefix (people write it; today's `source` accepted it).
- Split on the **first** `=` only.
- Strip one layer of surrounding matching quotes (`"…"` or `'…'`, length ≥ 2). No escape processing,
  no `$` expansion, no inline-comment stripping — a `#` inside a value is part of the value
  (`COLLIE_PUBLIC_URL=https://host/#x` must survive).
- Read with `while IFS= read -r line || [ -n "$line" ]` so a final line with no trailing newline is
  not dropped, and no backslash in a value is eaten.

**Malformed lines warn and are skipped — they must not abort.** Bricking `start` over one stray line
is worse than ignoring it, and there is no longer any security cost to ignoring it. The PowerShell
side throws instead; note that divergence in a comment and leave the PS script alone (out of scope).

**The warning must print the line NUMBER, never the line.** A malformed line may hold the VAPID
private key; echoing it into a Herdr plugin log or a journal re-leaks the exact secret this change
is protecting.

**Precedence is unchanged:** `.env` wins over an inherited environment variable of the same name,
because `set -a; .` overwrote too. Do not "improve" this to inherited-wins — `COLLIE_PORT` in `.env`
must keep taking effect.

Keep a running list of the keys assigned, so step 2 knows what to export:

```bash
COLLIE_ENV_KEYS=""      # space-joined; keys match ^[A-Za-z_][A-Za-z0-9_]*$, so word-splitting is safe
```

Also warn (do not fix, do not fail) at load time when `.env` is group- or other-readable — see step 3
for the mode helper. Loading happens on every invocation including `status`, so this is the
read-only half; the chmod belongs on the start path only.

Write a header comment saying **why**: the `.env` is config, not a script, and sourcing it was
arbitrary code execution as the operator on every command and at login. Point at
`contrib/windows/collie-ctl.ps1`'s `Import-CollieEnv` as the sibling implementation.

## Step 2 — export only to the bridge

```bash
# The bridge needs the whole config (COLLIE_VAPID_PRIVATE included); `git`, `tailscale`, `herdr`,
# `bun install` and `bunx tsc` do not. Export at the launch site, not at load.
export_bridge_env() { local k; for k in $COLLIE_ENV_KEYS; do export "$k"; done; }
```

`export "$k"` with a bare name exports the already-set variable — no `eval`, no value re-quoting.

Call sites:

- **`cmd_exec_bridge`** (line ~425) — call it before the `exec`. This is the launchd path, so
  without it the macOS bridge loses every `.env` setting. The existing comment ".env is already
  sourced above" becomes wrong; update it.
- **`start_unsupervised`** (line ~437) — the nohup fallback. **Wrap the launch in a subshell** so the
  exports do not leak into the rest of `cmd_start` (which goes on to run `tailscale serve`):

  ```bash
  ( export_bridge_env
    HERDR_SOCKET_PATH="$SOCKET" COLLIE_PORT="$PORT" HERDR_PLUGIN_CONFIG_DIR="$CONFIG_DIR" \
      nohup "$BUN" run "${PLUGIN_ROOT}/bridge/index.ts" >>"${CONFIG_DIR}/collie.log" 2>&1 &
    echo $! > "${CONFIG_DIR}/collie.pid" )
  ```

- **`cmd_push_test`** (line ~945) — `scripts/push-test.ts` needs `COLLIE_VAPID_*`. Same subshell
  shape: `( export_bridge_env; "$BUN" run "${PLUGIN_ROOT}/scripts/push-test.ts" "$@" )`.

Nothing else needs it. Checked:

- The **systemd path** never depended on the script's exports — `write_unit` writes
  `EnvironmentFile=-${CONFIG_DIR}/.env` and systemd parses it itself (systemd's parser is not a
  shell, so that side was never vulnerable). Leave the unit alone.
- The `tailscale serve` ownership probes pass `COLLIE_SERVE_*` to `bun -e` **inline** from local
  variables (lines ~649, ~782) — unaffected.
- `write_unit` / `write_agent` interpolate `$PORT` / `$SOCKET` as text — unaffected.

**Accepted behaviour change:** `COLLIE_DEV_TARGET` / `COLLIE_DEV_HOSTS` (read by
`web/vite.config.ts`) no longer reach a build spawned by `collie-ctl.sh`. They only configure the
Vite **dev server**, which `collie-ctl.sh` never launches. Mention it in the request file's
out-of-scope line rather than working around it.

## Step 3 — permissions

Two small helpers near the top:

```bash
# GNU and BSD stat take different flags and neither exists everywhere. Empty result = "can't tell",
# and every caller treats that as "say nothing".
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null || true; }

harden_config_perms() { … }   # chmod 700 dir, chmod 600 .env, warn if it was wider
```

`harden_config_perms` must:

- return 0 immediately if `$CONFIG_DIR` doesn't exist (the script runs under `set -e`);
- `chmod 700 "$CONFIG_DIR" || true` and `chmod 600 "${CONFIG_DIR}/.env" || true` — a chmod failure
  (a file the operator doesn't own) must warn, never abort a `start`;
- when `file_mode` returns something other than `600`, print one line naming the old mode and saying
  the key may already have been read: *"rotate COLLIE_VAPID_PRIVATE if other users have accounts on
  this host"*. A silent tightening hides a real exposure window.

Call it from **`cmd_start`** (first thing, before `ensure_build`), and right after each
`mkdir -p "$CONFIG_DIR"` in `write_unit`, `write_agent` and `start_unsupervised`. Do **not** call it
from `status` / `logs` / `update` — a read-only command must not mutate the operator's filesystem.
The load-time warning from step 1 covers those.

Then fix the two comments that lie today:

- line ~370 (`# … .env is mode 600 …`) — it is now true, but say *who* makes it true
  (`harden_config_perms` on the start path) so the plist's reasoning doesn't rest on an assumption
  again.
- lines 83-97 (the absolute-`$BUN` guard) — the threat named there ("a `bun()` defined in `.env`")
  is gone, because `.env` is no longer executed. The guard still earns its keep against a function
  or alias inherited from a caller's shell (the ctl script can be `source`d — the test suite does
  exactly that). Rewrite the rationale; keep the code.

## Step 4 — `self_dnsname` (line 177)

```bash
self_dnsname() {
  [ -n "$BUN" ] || return 0
  tailscale status --json 2>/dev/null | "$BUN" -e …
}
```

Returning empty when Bun is missing is already the handled case — `bridge_url` prints
`http://127.0.0.1:${PORT} (Tailscale name unavailable)`.

## Step 5 — docs

- `.env.example` lines 1-3: make the copy instruction two commands.

  ```
  #   cp .env.example "$(herdr plugin config-dir herdr.collie)/.env"
  #   chmod 600 "$(herdr plugin config-dir herdr.collie)/.env"
  ```

  Add one line: it can hold `COLLIE_VAPID_PRIVATE`, so keep it unreadable by other users; `start`
  enforces this too. Note that `.env` is parsed as plain `KEY=value` — no shell expansion, no
  command substitution.
- `README.md` around line 337: same `chmod 600` in the fenced block, plus one sentence that `.env`
  is parsed, not executed.

## Tests — `scripts/collie-ctl.test.sh`

The suite fakes everything on a scratch `PATH` with a throwaway `$HOME` and config dir. Follow the
existing shape: a `test_*` function, `setup_case <name>`, `run_ctl` or a generated harness that
`source`s `$CTL`, then `assert_eq` / `assert_contains` / `fail`. **Register every new function in
the call list at the bottom of the file** — an unregistered test never runs.

Add:

1. **`test_env_is_parsed_not_executed`** — the headline test. Write a `.env` containing every shape
   that used to execute:

   ```
   COLLIE_PORT=9999
   PWNED=$(touch "$CASE_DIR/pwned")
   ALSO_PWNED=`touch "$CASE_DIR/pwned2"`
   bun() { :; }
   ```

   Then `source` the script from a harness (as `test_non_absolute_bun_never_reaches_path` does) and
   echo `$COLLIE_PORT`. Assert: neither marker file exists; `COLLIE_PORT` is `9999`; the literal
   `$(touch …)` text is the value of `PWNED`, not an executed command.

2. **`test_env_parsing_grammar`** — quoted values are unquoted (`A="x y"` → `x y`), single quotes
   too, a value containing `=` keeps everything after the first `=`, a `#` inside a value survives,
   a `# comment` line and a blank line are skipped, a CRLF file parses (`printf 'COLLIE_PORT=9001\r\n'`),
   a final line with no newline parses, and `export COLLIE_PORT=9002` works.

3. **`test_env_malformed_line_warns_without_leaking`** — a `.env` with a junk line such as
   `not a valid line COLLIE_VAPID_PRIVATE=s3cret-value`. Assert the run **succeeds**, stderr
   mentions the file and the line number, and stderr does **not** contain `s3cret-value`.

4. **`test_env_secrets_do_not_reach_build_children`** — extend the fake `bun` (see
   `install_fake_bun`) to record `${COLLIE_VAPID_PRIVATE:-unset}` alongside its argv. With
   `COLLIE_VAPID_PRIVATE=s3cret` in `.env`: `push-test` must see the value; a bun invocation on the
   build path (e.g. `bash "$CTL" build`, whose `ensure_build` runs `"$BUN" install`) must see
   `unset`. Keep the recording format backwards-compatible with the existing `cut -d'|'` assertions
   in `test_bun_resolution` — append a new field, don't reorder.

5. **`test_env_permissions_are_hardened_on_start`** — `chmod 644` the `.env` and `chmod 755` the
   config dir, run the start path (the launchd/unsupervised fixtures in
   `test_launchd_agent_lifecycle` show the setup), then assert `file_mode`-equivalent output is
   `600` for `.env` and `700` for the dir, and that stderr warned about the old mode. Guard the
   whole test on a working `stat` so it skips cleanly where neither flag form exists.

6. **Update the comment** on `test_non_absolute_bun_never_reaches_path` (line ~780 and ~792): the
   function no longer models "what a doctored `.env` would leave behind" — it models a function
   inherited from the caller's shell. The test itself stays exactly as it is; only the words change.

The existing plist test (`.env` values must not be baked into the launchd plist,
`scripts/collie-ctl.test.sh:367,431`) must keep passing untouched.

## Verify

```bash
bash scripts/collie-ctl.test.sh          # must print "collie-ctl lifecycle tests: passed"
bash -n scripts/collie-ctl.sh            # parse check
bun test ./bridge                        # unchanged; confirm no new failures
```

Judge by exit status, not by words in the output. Per `CLAUDE.md`, 39 bridge tests fail on Windows
for POSIX path reasons — those are pre-existing; judge the bridge suite only by whether that count
moves. `scripts/collie-ctl.test.sh` needs a real bash + POSIX tools; run it under Git Bash or WSL.

Manual smoke, if a Linux/macOS host is available:

```bash
printf 'COLLIE_PORT=8788\nPWNED=$(touch /tmp/pwned)\n' > "$CONFIG_DIR/.env"
chmod 644 "$CONFIG_DIR/.env"
scripts/collie-ctl.sh status     # prints the port from .env, /tmp/pwned never appears
scripts/collie-ctl.sh start      # warns about mode 644, leaves .env at 600 and the dir at 700
```

## Out of scope

- The other audit issues (#1-#4, #6-#12) and anything in `bridge/`.
- `contrib/windows/collie-ctl.ps1` — it already parses correctly. Do not port the
  warn-and-skip behaviour to it in this change.
- Changing how systemd reads `EnvironmentFile` (systemd's parser is not a shell).
- Adding a `.env` schema, key allowlist, or validation of values. The key-name check is a safety
  gate for `printf -v`, not a config validator.
- Encrypting `.env` or moving `COLLIE_VAPID_PRIVATE` out of it.

## Versioning — bump nothing

`origin` is `bartholomewtj/collie` and `upstream` is `AltanS/collie`, so this is a **fork PR**.
Per `CLAUDE.md` → *Versioning*, leave `herdr-plugin.toml`, `package.json`, `web/package.json` and
`CHANGELOG.md` **exactly as they are** (all four agree on `0.29.0`; `scripts/check-version.sh` stays
green). The two commits already on this branch did the same.

The pre-commit hook will still object because `scripts/` changed — commit with
`SKIP_VERSION_CHECK=1 git commit …`, which is the documented escape hatch for this case.

Put a proposed CHANGELOG line in the PR description instead, e.g.:

> Fixed: `collie-ctl.sh` parses `.env` as `KEY=value` instead of executing it as shell, so a
> writable config file is no longer code execution; secrets are exported only to the bridge, and
> `start` enforces `chmod 700` on the config dir and `600` on `.env`.

## Branch and PR

The branch `fix/5-env-parse-not-source` already exists and is checked out. Commit the functional
change, push, and open the PR with `gh pr create`, referencing issue #5 (`Fixes #5`).
