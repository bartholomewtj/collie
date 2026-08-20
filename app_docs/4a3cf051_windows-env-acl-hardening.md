# Windows `.env` and Config Directory ACL Hardening

## Overview

On Windows (Git Bash / MSYS2 / Cygwin), `chmod` is a no-op on NTFS filesystems while `stat -c '%a'` reports mode `644`. Consequently, every execution of `bash scripts/collie-ctl.sh` triggered a false warning (`.env is mode 644 (expected 600)`) that could never be cleared, and config directory / secret file permissions (such as `COLLIE_VAPID_PRIVATE`) were not actually restricted.

This update introduces native NTFS ACL hardening using `icacls.exe` across both the bash CLI (`scripts/collie-ctl.sh`) and PowerShell lifecycle script (`contrib/windows/collie-ctl.ps1`). It strips inherited permissions (`/inheritance:r`) and grants Full Control solely to the current user (`/grant:r "<user>:(F)"`), silencing the spurious warning and enforcing real NTFS permission boundaries on Windows.

## Changed Files

- `scripts/collie-ctl.sh`:
  - Moved `is_windows()` up (before `harden_config_perms` and `load_env`).
  - Added `windows_user_principal()`, `harden_windows_acl()`, and `windows_acl_ok()` helpers using `icacls`.
  - Updated `harden_config_perms` and `load_env` to branch on `is_windows`, using `icacls` to restrict and verify NTFS ACLs instead of POSIX `chmod` / `stat -c %a`.
- `contrib/windows/collie-ctl.ps1`:
  - Added `Protect-CollieSecret` to strip inherited ACEs and grant the current user Full Control via `icacls.exe`.
  - Called `Protect-CollieSecret` in `Import-CollieEnv` (every dot-source/run) and in `Start-Collie` on `$script:ConfigDir` and `$script:EnvFile`.
- `contrib/windows/collie-ctl.test.ps1`:
  - Added unit test assertions verifying that inheritance is stripped (`(I)` absent) and the current user has `FullControl` (`(F)`) on `.env` and `$script:ConfigDir`.
- `scripts/collie-ctl.test.sh`:
  - Added `test_windows_acl_hardening_stubs_icacls` to verify that `harden_config_perms` delegates to `icacls` correctly on Windows platforms without breaking POSIX tests.
- `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md`:
  - Bumped version from `0.46.0` to `0.46.1` (PATCH release) and recorded changelog notes.
- `specs/4a3cf051_windows-env-acl-hardening.md`:
  - Implementation plan and verification specification.

## Verification

1. **Windows PowerShell test suite:**
   ```powershell
   powershell.exe -File contrib/windows/collie-ctl.test.ps1
   ```
   Asserts that `.env` and config directory ACL inheritance is stripped and the current user has Full Control.

2. **Linux / CI lifecycle test suite:**
   ```bash
   bash scripts/collie-ctl.test.sh
   ```
   Verifies POSIX `chmod 644 → warn → 600` test remains intact and passes `test_windows_acl_hardening_stubs_icacls`.

3. **Version check:**
   ```bash
   bash scripts/check-version.sh
   ```
