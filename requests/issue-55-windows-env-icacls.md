On Windows, stop warning that `.env` is mode 644 on every `bash scripts/collie-ctl.sh` run, and actually tighten it. chmod is a no-op on NTFS through MSYS, so the warning never clears — and `.env` now holds `COLLIE_VAPID_PRIVATE`.

On `is_windows` (scripts/collie-ctl.sh:205, added in #54): skip chmod/stat-mode. Run `icacls` instead — `/inheritance:r /grant:r "$USERNAME:F"` on the `.env` (and the config dir if that is the matching POSIX 700). Check with `icacls`, not `stat -c %a`. Do this in both `harden_config_perms` and the `load_env` mode warning (load_env is what prints on EVERY command; it currently runs at line 131, BEFORE `is_windows` is defined at 205 — move `is_windows` up so load_env can call it).

Same tightening in `contrib/windows/collie-ctl.ps1`: `Import-CollieEnv` and `Start-Collie` (the issue names both). The ps1 is the real Windows lifecycle; bash delegates start/stop/restart via `exec` so harden_config_perms in cmd_start never runs on Windows — the ps1 must do the work.

Do not change the POSIX path. `scripts/collie-ctl.test.sh` `test_env_permissions_are_hardened_on_start` (chmod 644 → warn "was mode 644" / "tightened to 600" / mode 600) must stay green on Linux. That suite already skips when chmod is a no-op.

Where: scripts/collie-ctl.sh (is_windows, harden_config_perms, load_env), contrib/windows/collie-ctl.ps1 (Import-CollieEnv, Start-Collie), contrib/windows/collie-ctl.test.ps1 (assert icacls inheritance stripped / current user FullControl on a temp .env). Optional: a bash test of the Windows branch if you can stub icacls without breaking the POSIX suite.

Done means: Git Bash `collie-ctl.sh status` (or any verb) on Windows no longer prints `.env is mode 644`. After start/import, icacls on `.env` shows inheritance disabled and the current user FullControl. POSIX chmod-based test still passes. `bun test ./scripts` and `contrib/windows/collie-ctl.test.ps1` pass. PATCH bump 0.46.0 → 0.46.1 in herdr-plugin.toml, package.json, web/package.json, CHANGELOG Fixed.

Out of scope: Linux/macOS permission behaviour, rotating keys, adws/, quality.py, other issues, docs PRs #84/#86, rewriting load_env's key=value parser.
