# Plan — Windows: harden `.env` via `icacls` instead of a no-op chmod (0.46.0 → 0.46.1)

## Problem

On Windows (Git Bash / MSYS), `chmod` is a no-op on NTFS but `stat -c '%a'` still reports a mode
(644-ish) through MSYS, so:

- `load_env` (runs on **every** `collie-ctl.sh` invocation, at source time) prints
  `warn: …/.env is mode 644 (expected 600)` forever — the warning can never be cleared.
- `harden_config_perms` chmods to no effect. `.env` now holds `COLLIE_VAPID_PRIVATE`, so this is a
  real secret with a cosmetic guard.
- On Windows, `cmd_start` delegates to `contrib/windows/collie-ctl.ps1` via `exec` *before*
  `harden_config_perms` runs (line 617 before 618), so the ps1 — the real Windows lifecycle — must do
  the hardening itself.

The POSIX path (Linux/macOS) must not change: `scripts/collie-ctl.test.sh`
`test_env_permissions_are_hardened_on_start` asserts the chmod 644 → warn → 600 flow and must stay
green.

**Done means:** `bash scripts/collie-ctl.sh status` (any verb) on Windows prints no `.env is mode
644`; after start/import, `icacls` on `.env` shows inheritance disabled (`(I)` gone) and the
current user `(F)`; the POSIX chmod test still passes; `bash scripts/collie-ctl.test.sh` (Linux/CI)
and `contrib/windows/collie-ctl.test.ps1` (Windows) both pass; version bumped to 0.46.1 in all
three files + CHANGELOG; `scripts/check-version.sh` prints ✓.

## Files to touch

1. `scripts/collie-ctl.sh` — move `is_windows` up; add icacls helpers; branch in `harden_config_perms`
   and `load_env`.
2. `contrib/windows/collie-ctl.ps1` — new `Protect-CollieSecret`; call it from `Import-CollieEnv`
   and `Start-Collie`.
3. `contrib/windows/collie-ctl.test.ps1` — assert inheritance stripped / current user FullControl on
   the temp `.env` (and dir).
4. `scripts/collie-ctl.test.sh` — optional new test stubbing `icacls` (must not disturb the POSIX
   suite).
5. `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md` — PATCH bump 0.46.0 →
   0.46.1.

## 1. `scripts/collie-ctl.sh`

### 1a. Move `is_windows()` up (currently ~line 205, defined *after* `load_env` runs at line 131)

Move the whole `is_windows()` function **with its explanatory comment block** to sit right after
`file_mode()` (~line 44) / immediately before `harden_config_perms`. The body is unchanged:

```bash
is_windows() {
  case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; esac
  return 1
}
```

Safe to move: its only callers (`cmd_start`/`cmd_stop`/`cmd_restart` and the new helpers below) run
at call time, long after source completes.

### 1b. New helpers (placed with `is_windows`, before `harden_config_perms`)

```bash
# NTFS has no POSIX modes — `stat -c %a` through MSYS reports fiction and `chmod` does nothing, so
# the POSIX 600/700 dance can neither tighten nor verify anything. The Windows analogue is an ACL:
# strip inheritance (/inheritance:r) and grant only the current user Full Control (/grant:r).
windows_user_principal() {
  if [ -n "${USERDOMAIN:-}" ] && [ -n "${USERNAME:-}" ]; then
    printf '%s\\%s' "$USERDOMAIN" "$USERNAME"
  else
    printf '%s' "${USERNAME:-$(id -un)}"
  fi
}

harden_windows_acl() {
  command -v icacls >/dev/null 2>&1 || return 0
  icacls "$1" /inheritance:r /grant:r "$(windows_user_principal):F" >/dev/null 2>&1 || true
}

# True when `icacls <path>` shows the current user with (F) and no inherited ACEs. That is the
# checkable form of "mode 600": one principal, full control, nothing inherited.
windows_acl_ok() {
  command -v icacls >/dev/null 2>&1 || return 0   # can't check → say nothing
  local out
  out="$(icacls "$1" 2>/dev/null || true)"
  [ -n "$out" ] || return 0
  printf '%s' "$out" | grep -qiF '(I)' && return 1
  printf '%s' "$out" | grep -qiF "${USERNAME:-$(id -un)}:(F)"
}
```

Notes:
- `grep -i` because icacls echoes the principal with its own casing; matching the bare username as a
  substring of `DOMAIN\user:(F)` works either way.
- Escape parens with `grep -F` fixed-string matching (`'(I)'`, `':(F)'`) — do not use an unescaped
  regex.
- Everything must survive `set -euo pipefail`: commands feeding `grep` sit in pipelines guarded by
  `if !`/`|| true`.

### 1c. `harden_config_perms` — Windows branch first, POSIX path byte-identical

```bash
harden_config_perms() {
  [ -d "$CONFIG_DIR" ] || return 0
  if is_windows; then
    harden_windows_acl "$CONFIG_DIR"
    if [ -f "${CONFIG_DIR}/.env" ]; then
      harden_windows_acl "${CONFIG_DIR}/.env"
      windows_acl_ok "${CONFIG_DIR}/.env" || \
        echo "warn: ${CONFIG_DIR}/.env ACL still allows other users; rotate COLLIE_VAPID_PRIVATE if other users have accounts on this host." >&2
    fi
    return 0
  fi
  # …existing chmod 700/600 body, unchanged…
}
```

No chmod, no `file_mode`, no "was mode ${mode}" text on Windows.

### 1d. `load_env` — Windows branch replaces the stat-mode warning

Inside `load_env`, replace the unconditional stat-mode warning block with:

```bash
  if is_windows; then
    # stat -c %a through MSYS is fiction on NTFS; tighten + verify with icacls instead.
    if ! windows_acl_ok "$env_file"; then
      harden_windows_acl "$env_file"
      windows_acl_ok "$env_file" || \
        echo "warn: ${env_file} is readable by other users (tightened ACL to current user only); rotate COLLIE_VAPID_PRIVATE if this host has other accounts." >&2
    fi
  else
    local mode; mode="$(file_mode "$env_file")"
    # …existing case 600|400|0600|0400 / warn block, unchanged verbatim…
  fi
```

Key property: on a healthy Windows install, `windows_acl_ok` is true and **load_env prints nothing**.
No "mode 644" anywhere on the Windows path. icacls is idempotent, so tightening on every command is
fine. The key=value parsing below the warning is untouched (out of scope).

## 2. `contrib/windows/collie-ctl.ps1`

Add next to `Import-CollieEnv` (before its call site at ~line 65):

```powershell
# NTFS analogue of chmod 600/700: strip inherited ACEs and grant only the current user Full
# Control. chmod through MSYS is a no-op on NTFS, so the bash side's POSIX hardening never took
# effect here. Failure warns rather than throws — start must not brick over an ACL it can't set.
function Protect-CollieSecret([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $user = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
  & icacls.exe $Path /inheritance:r /grant:r "${user}:(F)" *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "could not restrict ACL on $Path (icacls exit $LASTEXITCODE)"
  }
}
```

Call sites:
- `Import-CollieEnv`: first statement after the `Test-Path` guard — `Protect-CollieSecret $Path`.
  This is the ps1's every-invocation path (it runs at dot-source time, line 65), mirroring what
  `load_env` now does on the bash side.
- `Start-Collie`: first lines of the function — `Protect-CollieSecret $script:ConfigDir` and
  `Protect-CollieSecret $script:EnvFile`. This is the real `start` on Windows (bash's `cmd_start`
  execs out to this script before its own `harden_config_perms` ever runs), so it must do the
  hardening itself: dir (the 700 analogue) and `.env` (the 600 analogue). Redundant with the import
  when `.env` already existed, deliberately so — `.env` may have been created or had its ACL
  disturbed since dot-source.

`icacls.exe` explicitly (never rely on a same-named function/alias). Note the ps1 runs under
`Set-StrictMode -Version Latest` — the env-var reads are null-safe as written.

## 3. `contrib/windows/collie-ctl.test.ps1`

The suite already dot-sources the ctl with `HERDR_PLUGIN_CONFIG_DIR` pointing at a temp dir holding
a temp `.env`, so `Import-CollieEnv` → `Protect-CollieSecret` runs for real there. After the
dot-source assertions (the `.env port` / quoted-value block), add:

```powershell
$envAcl = (& icacls.exe $script:EnvFile | Out-String)
Assert-Equal ($envAcl -match '\(I\)') $false ".env ACL inheritance stripped"
Assert-Equal ([regex]::IsMatch($envAcl, [regex]::Escape("$env:USERNAME:(F)"), 'IgnoreCase')) $true ".env current user FullControl"

Protect-CollieSecret $script:ConfigDir
$dirAcl = (& icacls.exe $script:ConfigDir | Out-String)
Assert-Equal ($dirAcl -match '\(I\)') $false "config dir ACL inheritance stripped"
Assert-Equal ([regex]::IsMatch($dirAcl, [regex]::Escape("$env:USERNAME:(F)"), 'IgnoreCase')) $true "config dir current user FullControl"
```

- Regex-escape + `IgnoreCase` because icacls echoes the principal with its own casing (and may
  domain-qualify it); the bare `username:(F)` substring matches either form.
- Directly calling `Protect-CollieSecret` on the dir avoids driving the full `Start-Collie` (which
  the suite deliberately never does — it stubs the scheduler and registers nothing).
- The temp `.env` now carries a hardened ACL; harmless, the temp dir is removed in the suite's
  cleanup. (`icacls` runs only on the test's own temp files — nothing on the operator's machine is
  touched.)

## 4. Optional bash test of the Windows branch (`scripts/collie-ctl.test.sh`)

Add `test_windows_acl_hardening_stubs_icacls`, guarded so it can't disturb the POSIX suite (it
depends only on a PATH stub, never on chmod):

- Create a fake `icacls` executable in the case's `$BIN_DIR` that:
  - when invoked with `/inheritance:r`, appends `GRANT|<all args>` to a log file and exits 0;
  - when invoked with no flags (the check form), appends `CHECK|<path>` and prints
    `"${USERNAME}:(F)"`, exits 0.
- Harness: `source "$CTL"` (load_env runs while `is_windows` is still real → false on Linux, so the
  source-time path stays POSIX), then **after** sourcing redefine `is_windows() { return 0; }`, then
  call `harden_config_perms`.
- Assert: the log contains the `.env` and `$CONFIG_DIR` paths with `/inheritance:r` and
  `/grant:r`; stderr contains neither "mode 644" nor "tightened to 600".
- Register it in the runner list next to `test_env_permissions_are_hardened_on_start`.

If the stub proves flaky under the suite's environment, dropping this test is acceptable — the ps1
suite covers the real behaviour; the bash test is belt-and-braces.

## 5. Version bump — PATCH 0.46.0 → 0.46.1

1. Land the functional commits first (ctl.sh + ps1 + tests), then the release commit, so the
   CHANGELOG line can cite the functional commit's short hash.
2. `herdr-plugin.toml` (line 3), `package.json` (line 3), `web/package.json` (line 3): `0.46.0` →
   `0.46.1`.
3. `CHANGELOG.md`: new heading `## [0.46.1] - <real date>` above `## [0.46.0]`, one `### Fixed`
   entry, super crisp, hash-cited:

   ```markdown
   ## [0.46.1] - YYYY-MM-DD

   ### Fixed
   - Windows: .env and config dir ACLs hardened with icacls (inheritance stripped, current user Full Control) instead of a chmod that never takes effect on NTFS; Git Bash no longer warns ".env is mode 644" on every command (abc1234)
   ```

4. `scripts/check-version.sh` must print `✓`.
5. Tag when pushed: `git tag -a v0.46.1 -m "Collie 0.46.1"` + `git push --follow-tags`.

## Verification checklist

- **Windows box (or CI-pre-push):** `pwsh -File contrib/windows/collie-ctl.test.ps1` (or
  `powershell.exe`) — green, including the two new ACL assertions.
- **Windows manual:** `bash scripts/collie-ctl.sh status` (and `start` via the ps1) prints **no**
  `.env is mode 644`; `icacls "<configdir>\.env"` lists only the current user with `(F)` and no
  `(I)`.
- **Linux/WSL (or CI):** `bash scripts/collie-ctl.test.sh` green — specifically
  `test_env_permissions_are_hardened_on_start` still asserts "was mode 644" / "tightened to 600" /
  mode 600/700 (the suite self-skips on Windows, so run it from Linux/WSL).
- **Root/backend + web tests** (pre-push runs both): `bun run test` at root, `cd web && bun run test`.
- `bash scripts/check-version.sh` → `✓`.

## Out of scope (do not touch)

Linux/macOS permission behaviour · key rotation · `adws/` · `quality.py` · unrelated issues · docs
PRs #84/#86 · `load_env`'s key=value parser (only the warning block changes) · any second front
door or notification behaviour.

## Gotchas for the builder

- `load_env` is *invoked* at line 131 — `is_windows` and both icacls helpers must be **defined**
  above that point. That ordering, not the branch logic, is the actual trap in this change.
- On Windows the bash suite self-skips at the top (`MINGW*|MSYS*|CYGWIN*` guard) — don't try to make
  it run there; the ps1 suite is the Windows lifecycle's test surface (CLAUDE.md says exactly this).
- Keep every POSIX warning string byte-identical; three assertions in
  `test_env_permissions_are_hardened_on_start` pin them.
- `set -euo pipefail` is on: any `icacls | grep` pipeline in a helper must be consumed by `if !` /
  `|| true` or the whole ctl dies on the first non-zero grep.
- Never commit or print `.env` contents; the helpers only ever touch paths and ACLs.
- `C:\claudeos` is not a git repo — all git work happens inside `Projects\tools\collie`.
