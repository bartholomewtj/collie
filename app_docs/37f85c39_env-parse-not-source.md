# `.env` Safe Parsing and Permission Hardening in `collie-ctl.sh` (Issue #5)

## Summary

Replaced shell `source`/`eval` execution of `.env` in `scripts/collie-ctl.sh` with a secure key-value parser, scoped environment variable exports to bridge execution contexts, hardened permissions on the configuration directory and `.env` file (`700`/`600`), and fixed bare `bun` execution in `self_dnsname`.

## Context & Motivation

Previously, `scripts/collie-ctl.sh` executed `set -a; . "${CONFIG_DIR}/.env"; set +a`. This presented three security and robustness issues:
1. **Arbitrary Code Execution**: Sourcing `.env` executed arbitrary shell commands on any invocation of `collie-ctl.sh` (e.g. `status`, `start`, `stop`, `update`, `build`) and upon macOS login via launchd.
2. **Secret Leakage to Build & Subprocesses**: `set -a` exported all variables—including `COLLIE_VAPID_PRIVATE`—to child processes such as `git`, `tailscale`, `herdr`, `bun install`, and `bunx tsc`.
3. **Unenforced Permissions**: Comments claimed `.env` was mode `600`, but neither the setup documentation nor the control script enforced permissions or directory modes (`700`/`600`), leaving sensitive VAPID keys potentially readable on multi-user systems.

## Changes Made

### 1. Safe `.env` Key-Value Parser
- **`scripts/collie-ctl.sh` (`load_env`)**:
  - Implemented a bash 3.2-compatible parser that reads `${CONFIG_DIR}/.env` line by line without `source` or `eval`.
  - Handles comments (`#`), blank lines, leading/trailing whitespace, CRLF line endings, and optional `export ` prefixes.
  - Strips matching single or double quotes (`'` or `"`) from values without stripping inline `#` characters.
  - Validates keys against valid identifier names (`^[A-Za-z_][A-Za-z0-9_]*$`).
  - Sets variables globally using `printf -v "$key" '%s' "$val"` without exporting them into the environment.
  - Warns on malformed lines with line numbers on `stderr` without echoing line contents or secret values.
  - Tracks assigned keys in `COLLIE_ENV_KEYS`.

### 2. Scoped Secret Exports
- **`scripts/collie-ctl.sh` (`export_bridge_env`)**:
  - Exports parsed keys only when launching the bridge or push testing:
    - `cmd_exec_bridge`: Exports `COLLIE_ENV_KEYS` before executing the supervised bridge process.
    - `start_unsupervised`: Runs inside a subshell `( export_bridge_env; ... )` so secrets do not leak to subsequent commands.
    - `cmd_push_test`: Runs inside a subshell `( export_bridge_env; ... )` for `scripts/push-test.ts`.
  - Build processes (`cmd_build`) and utility commands no longer inherit `COLLIE_VAPID_PRIVATE`.

### 3. Permission Hardening
- **`scripts/collie-ctl.sh` (`harden_config_perms`, `file_mode`)**:
  - Added portable file mode detection across GNU and BSD `stat`.
  - Tightens `$CONFIG_DIR` to `700` and `.env` to `600` during start workflows (`cmd_start`, `write_unit`, `write_agent`, `start_unsupervised`).
  - Emits a warning if `.env` had permissions wider than `600` (advising key rotation if on a shared host).
  - Emits a load-time warning if `.env` is readable by other users.
- **`.env.example` & `README.md`**:
  - Added `chmod 600 "$(herdr plugin config-dir herdr.collie)/.env"` to setup instructions.
  - Documented that `.env` is parsed as plain `KEY=value` pairs rather than shell scripts.

### 4. Direct Bun Invocation in DNS Probing
- **`scripts/collie-ctl.sh` (`self_dnsname`)**:
  - Replaced unquoted bare `bun` invocation with `"$BUN"`.
  - Added validation `[ -n "$BUN" ] || return 0`.

### 5. Test Suite & Specifications
- **`scripts/collie-ctl.test.sh`**:
  - Added `test_env_is_parsed_not_executed`: Verifies command substitution and backticks in `.env` are not executed.
  - Added `test_env_parsing_grammar`: Verifies quoted values, internal `=`, `#` in URLs, `export` prefixes, CRLF line endings, and EOF without newline.
  - Added `test_env_malformed_line_warns_without_leaking`: Verifies malformed lines produce warnings with line numbers but do not leak secrets or abort execution.
  - Added `test_env_secrets_do_not_reach_build_children`: Verifies `COLLIE_VAPID_PRIVATE` reaches `push-test` but is unset during `build`.
  - Added `test_env_permissions_are_hardened_on_start`: Verifies permissions are tightened to `700`/`600` and warnings are emitted on wider modes.
- **`specs/37f85c39_env-parse-not-source.md` & `requests/issue-5-env-parse-not-source.md`**:
  - Added specification and request records for issue #5.

## Verification

Run the `collie-ctl` lifecycle test suite:
```bash
./scripts/collie-ctl.test.sh
```
All lifecycle tests pass, including the five new `.env` parsing and hardening test suites.
