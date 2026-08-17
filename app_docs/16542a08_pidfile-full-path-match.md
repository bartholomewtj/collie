# Stale PID File Full-Path Verification (Issue #12)

## Summary

Updated `scripts/collie-ctl.sh` to verify the full path of the bridge script (`${PLUGIN_ROOT}/bridge/index.ts`) before terminating a process recorded in a stale PID file. This prevents recycled PIDs belonging to other checkouts or processes from being inadvertently terminated on service start or stop.

## Context & Motivation

When the Collie bridge daemon exits abnormally (such as via SIGKILL, panic, or system reboot), a legacy `collie.pid` file may remain on disk. When `collie-ctl.sh` runs `start` or `stop`, `stop_pidfile_process()` inspects the process table for the recorded PID to determine if it is still a running bridge instance.

Previously, `scripts/collie-ctl.sh` checked the command line using a loose substring match:
```sh
case "$(ps -p "$pid" -o command= 2>/dev/null)" in
  *bridge/index.ts*) kill -- "$pid" 2>/dev/null || true ;;
esac
```

If the operating system recycled the PID to another process whose command line contained `bridge/index.ts` (for example, a developer running a different Collie checkout or branch in another directory), `stop_pidfile_process()` would send a kill signal to that unrelated process.

`contrib/windows/collie-ctl.ps1` already verified the full path (`Join-Path $script:PluginRoot "bridge\index.ts"`). `scripts/collie-ctl.sh` has now been updated to match this behavior.

## Changes Made

### 1. Process Command-Line Matching
- **`scripts/collie-ctl.sh` (`stop_pidfile_process`)**:
  - Replaced the glob pattern `*bridge/index.ts*` with `*"${PLUGIN_ROOT}/bridge/index.ts"*`.
  - Quoted `${PLUGIN_ROOT}/bridge/index.ts` to ensure path literals containing glob characters are treated literally while retaining outer wildcards.

### 2. Test Harness & Fixture Updates
- **`scripts/collie-ctl.test.sh` (`test_launchd_agent_lifecycle`)**:
  - Updated mock `ps` function so PID 4242 matches `${ROOT}/bridge/index.ts` (current checkout).
  - Added PID 4244 fixture representing `/elsewhere/collie/bridge/index.ts` (foreign checkout).
  - Verified that writing 4244 to `collie.pid` and calling `stop_pidfile_process` does not signal PID 4244 and only signals PID 4242.

### 3. Version Bump & Changelog
- Bumped version from `0.31.0` to `0.31.1` (patch release) across:
  - `herdr-plugin.toml`
  - `package.json`
  - `web/package.json`
  - `CHANGELOG.md`

## Verification

The changes were verified using the shell test suite:

1. **Syntax Check**:
   ```bash
   bash -n scripts/collie-ctl.sh
   bash -n scripts/collie-ctl.test.sh
   ```
2. **Lifecycle & Regression Tests**:
   ```bash
   bash scripts/collie-ctl.test.sh
   ```
   Confirms `test_launchd_agent_lifecycle` passes and non-matching/foreign PIDs are spared.
3. **Version Consistency**:
   ```bash
   bash scripts/check-version.sh
   ```
