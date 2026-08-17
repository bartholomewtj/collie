# Issue #12 — Ops hardening: CI permissions/pins, systemd directives, pidfile match, Windows arg quoting

Source: GitHub issue #12 (`bartholomewtj/collie`), label `security`, severity **Low**.
There is no `requests/issue-12-ops-hardening.md` in the repo — the issue body on GitHub is the
spec. Its line numbers have drifted; the real locations are given below.

Nothing here is High. The bridge never shells out and `bun audit` at the root is clean. This is
supply-chain and blast-radius work: make CI's token minimal and its actions immutable, confine the
systemd service, stop a pid match that can kill a bystander, and stop two Windows launchers
re-splitting a path.

---

## Scope

Five items in the issue. **Four are in scope. Item 5 is explicitly deferred** — see the last
section. Do not run `bun update` and do not touch either lockfile in this change.

---

## 1. CI workflow: add `permissions:`, pin actions to SHAs

**Files:** `.github/workflows/ci.yml`, `.github/workflows/release.yml`

`ci.yml` has no `permissions:` block, so the job inherits the repository default token scope. It
needs nothing but read. `release.yml` already has a minimal `contents: write` and no untrusted
interpolation — leave its permissions alone, only pin its action.

Both files reference actions by mutable tag (`@v4`, `@v2`). A tag can be moved. Pin to a commit
SHA with the tag named in a trailing comment so the next person can tell what it is.

### Resolve the SHAs first

Run these and use the output — do not copy a SHA from memory or from another repo:

```bash
gh api repos/actions/checkout/commits/v4 --jq .sha
gh api repos/oven-sh/setup-bun/commits/v2 --jq .sha
```

`repos/OWNER/REPO/commits/<ref>` resolves a ref straight to the commit SHA, which is what a
workflow `uses:` needs. Do not use `git/ref/tags/<tag>` — for an annotated tag that returns the tag
object's SHA, not the commit, and the workflow will fail to resolve it.

### `ci.yml`

Add a top-level `permissions:` block between `on:` and `concurrency:`:

```yaml
# The job only reads the repo — no releases, no comments, no packages. Naming the scope here stops
# the workflow inheriting whatever the repository default happens to be.
permissions:
  contents: read
```

Change the two `uses:` lines in the `check` job:

```yaml
      - uses: actions/checkout@<sha>   # v4
      - uses: oven-sh/setup-bun@<sha>  # v2
```

### `release.yml`

Change line 16 only:

```yaml
      - uses: actions/checkout@<sha>   # v4
```

Use the same checkout SHA in both files. Leave the existing `permissions: contents: write` and its
comment untouched.

### Verify

There is no local workflow runner. YAML validity and the pins are confirmed by the PR's own CI run
— check the run goes green and that the "Set up job" log shows the pinned SHAs resolving.

---

## 2. systemd unit hardening (and quote the generated values)

**Files:** `systemd/collie.service` (the hand-managed reference copy) and `scripts/collie-ctl.sh`
`write_unit()` at **lines 427–458** (the heredoc that generates the live unit).

These two must stay in step — the reference file exists so an operator managing the unit by hand
gets the same service. Make the same edit in both. The reference copy uses `@PLACEHOLDERS@` and
`%h`; the generated copy interpolates shell variables.

### 2a. Add the directives

Today the `[Service]` block sets only `NoNewPrivileges=yes` and `PrivateTmp=yes`. Add, directly
below them:

```ini
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
SystemCallArchitectures=native
UMask=0077
# Address families the bridge actually uses: AF_UNIX for Herdr's socket, AF_INET/AF_INET6 for the
# loopback listener and outbound HTTPS (the update check hits api.github.com, web push hits the
# provider endpoints), AF_NETLINK because glibc's resolver enumerates interfaces over netlink —
# omit it and DNS fails in ways that look like the network is down.
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
```

Extend the existing hardening comment above `NoNewPrivileges` so it covers the new block rather
than leaving a stale two-line explanation above ten directives.

### 2b. Three directives that must NOT be added — write this down in the unit

The issue floats `MemoryDenyWriteExecute` as "test it". **Don't add it.** Bun's JIT needs
writable-then-executable mappings; the service will crash at startup. Leave a comment at the
directive block saying so, so the next person doesn't rediscover it in production:

```ini
# MemoryDenyWriteExecute is deliberately absent — Bun's JIT needs W^X-capable mappings and the
# bridge will not start with it set.
# ProtectHome is deliberately absent — bridge/journal/ reads the agent's own session logs from
# under $HOME, and the config dir lives there too.
# ProtectSystem is deliberately absent — see the note above.
```

The `ProtectSystem` reasoning is already in the file; keep it, don't duplicate the argument, just
make the three exclusions sit together so they read as a set.

### 2c. Quote the interpolated unit values

In `write_unit()` the heredoc emits values raw:

```
WorkingDirectory=${PLUGIN_ROOT}
ExecStart=${BUN} run ${PLUGIN_ROOT}/bridge/index.ts
Environment=HERDR_SOCKET_PATH=${SOCKET}
Environment=COLLIE_PORT=${PORT}
Environment=HERDR_PLUGIN_CONFIG_DIR=${CONFIG_DIR}
EnvironmentFile=-${CONFIG_DIR}/.env
```

systemd splits `Environment=` and `ExecStart=` on whitespace, so a checkout or config dir
containing a space silently truncates the value — the service starts with a wrong socket path and
fails in a way that points nowhere near the cause. Quote each:

```
WorkingDirectory="${PLUGIN_ROOT}"
ExecStart="${BUN}" run "${PLUGIN_ROOT}/bridge/index.ts"
Environment="HERDR_SOCKET_PATH=${SOCKET}"
Environment="COLLIE_PORT=${PORT}"
Environment="HERDR_PLUGIN_CONFIG_DIR=${CONFIG_DIR}"
EnvironmentFile=-"${CONFIG_DIR}/.env"
```

Note the `-` in `EnvironmentFile` goes **outside** the quote — it is systemd's "optional" prefix,
not part of the path.

Scope limit: this fixes spaces. A path containing a literal `"` or `\` still needs systemd's
C-style escaping and is out of scope at this severity — don't build an escaper for it.

Apply the same quoting to the reference `systemd/collie.service` where it makes sense (its values
are `@PLACEHOLDERS@` and `%h/...`, which have the same exposure once substituted).

### 2d. Fix the now-stale launchd comment

`scripts/collie-ctl.sh` around **line 463** says the launchd agent has "no analogue:
StartLimitIntervalSec, NoNewPrivileges / PrivateTmp". That list is about to be wrong. Reword to
say the systemd hardening block as a whole has no launchd analogue, so the agent is the less
confined of the two.

### Verify

- `bash -n scripts/collie-ctl.sh` exits 0.
- `bun run test` at the root (the ctl suite generates units in a sandbox — confirm nothing in it
  asserts on the old unquoted lines; grep the suite for `Environment=` and `ExecStart=` and update
  any literal expectation).
- The real check is on the Linux deployment host, not the dev box:
  `systemd-analyze verify ~/.config/systemd/user/collie.service` (must be silent) and
  `systemd-analyze security collie` (the exposure score should drop from its current value). If
  `systemd-analyze` isn't available where you're building, say so in the PR rather than claiming
  it passed.
- Note in the PR: the unit is only rewritten by `write_unit()`, which runs on `start`. Since
  `cmd_restart()` is `cmd_stop; cmd_start`, both `restart` and `update` regenerate it — no extra
  operator step.

---

## 3. Pidfile kill matches on a substring

**File:** `scripts/collie-ctl.sh`, `stop_pidfile_process()` — the `case` at **line 215**.

```sh
case "$(ps -p "$pid" -o command= 2>/dev/null)" in
  *bridge/index.ts*) kill -- "$pid" 2>/dev/null || true ;;
esac
```

The guard exists because pids get recycled and this also runs on `start`. But `bridge/index.ts`
matches *any* checkout — a second clone, a dev shell running the bridge from another directory, a
`vim bridge/index.ts`. A recycled pid on one of those gets killed.

Change to the full path, which is exactly the string the launcher wrote
(`start_unsupervised()` at line 543 runs `nohup "$BUN" run "${PLUGIN_ROOT}/bridge/index.ts"`):

```sh
case "$(ps -p "$pid" -o command= 2>/dev/null)" in
  *"${PLUGIN_ROOT}/bridge/index.ts"*) kill -- "$pid" 2>/dev/null || true ;;
esac
```

Quoting the variable inside a `case` pattern is deliberate: it makes the expansion literal, so a
checkout path containing `*` or `?` can't turn into a glob. Keep the quotes.

The Windows script already does the equivalent (`collie-ctl.ps1:371` checks the launcher's
`CommandLine` contains the resolved `collie-ctl.ps1` path).

### Add a regression test

Append to `scripts/collie-ctl.test.sh`:

```sh
# The pidfile outlives its process and pids get recycled, so `start` re-checks before killing.
# The check used to match any `bridge/index.ts` — a second checkout, a dev shell — and would kill
# a bystander. It must match THIS checkout's absolute path and nothing else.
test_pidfile_kill_requires_our_checkout() {
  setup_case pidfile-match
  ...
}
```

Build it the same way `test_env_permissions_are_hardened_on_start()` (line 1335) does — write a
harness script that `source`s `$CTL` and overrides functions, because `kill` is a shell builtin and
cannot be shadowed on the scratch PATH:

- Write `${CONFIG_DIR}/collie.pid` containing a plausible pid (e.g. `4242`).
- In the harness, after `source "$CTL"`, define `ps() { printf '%s\n' "$FAKE_CMDLINE"; }` and
  `kill() { echo "$*" >> "$KILL_LOG"; }`.
- Case A — foreign checkout: `FAKE_CMDLINE="/usr/bin/bun run /some/other/checkout/bridge/index.ts"`.
  Call `stop_pidfile_process`. Assert `$KILL_LOG` does not exist or is empty.
- Case B — our checkout: `FAKE_CMDLINE="/usr/bin/bun run ${PLUGIN_ROOT}/bridge/index.ts"` (read
  `$PLUGIN_ROOT` from the sourced script so it matches what the code compares against). Call
  `stop_pidfile_process`. Assert `$KILL_LOG` contains the pid.
- Both cases: assert the pidfile is removed afterwards — that happens unconditionally today and
  must keep happening, or a stale file blocks the next start.

Register the new function in the runner list at the bottom of the file (lines 1389–1418) —
defining it without adding it to that list means it silently never runs.

### Verify

`bun run test` at the root. The ctl suite is part of it.

---

## 4. Windows launchers rejoin arguments unquoted

Both files are community-maintained contrib and are **not exercised by CI** (there is no PowerShell
or Windows job). Verification is by inspection; say so in the PR.

### 4a. `contrib/windows/collie-action.cs` lines 16–17

```csharp
Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" +
    Path.Combine(root, "contrib", "windows", "collie-ctl.ps1") + "\" " + string.Join(" ", args),
```

`string.Join(" ", args)` throws away the argv boundaries. An argument containing a space becomes
two arguments; one containing a quote breaks the command line apart. The script path itself is
wrapped in bare quotes and has the same problem if the checkout path contains a quote.

Add a quoter implementing the `CommandLineToArgvW` rules and run every part through it:

```csharp
// Windows has no argv — a process receives one string and each runtime re-splits it with
// CommandLineToArgvW's rules. Rejoining with a bare space therefore loses the boundaries: a path
// with a space becomes two arguments. Quote when needed, escape embedded quotes, and double the
// backslashes that immediately precede a quote (only there — that is the rule).
private static string Quote(string arg)
{
    if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;

    var sb = new System.Text.StringBuilder();
    sb.Append('"');
    for (var i = 0; i < arg.Length; i++)
    {
        var backslashes = 0;
        while (i < arg.Length && arg[i] == '\\') { backslashes++; i++; }
        if (i == arg.Length) { sb.Append('\\', backslashes * 2); break; }
        if (arg[i] == '"') { sb.Append('\\', backslashes * 2 + 1); }
        else { sb.Append('\\', backslashes); }
        sb.Append(arg[i]);
    }
    sb.Append('"');
    return sb.ToString();
}
```

Then build the argument string from quoted parts:

```csharp
var script = Path.Combine(root, "contrib", "windows", "collie-ctl.ps1");
var quoted = new string[args.Length];
for (var i = 0; i < args.Length; i++) quoted[i] = Quote(args[i]);
Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(script) +
    (quoted.Length > 0 ? " " + string.Join(" ", quoted) : "");
```

Add `using System.Text;` or keep the fully-qualified `System.Text.StringBuilder` as above — either,
but be consistent with the file's existing `using` block.

Note the empty-argument case: `arg.Length > 0 &&` in the guard means an empty string falls through
to the quoting branch and comes out as `""`, which is correct. Don't "simplify" that condition away.

### 4b. `contrib/windows/collie-ctl.ps1` line 223

```powershell
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -TaskConfigDir "{1}" -TaskSocketPath "{2}"  _exec-bridge' -f $ctl, $script:ConfigDir, $script:SocketPath
```

Same defect: a value containing `"` closes the quote early and the scheduled task launches with
garbage arguments. `$ConfigDir` and `$SocketPath` come from `HERDR_PLUGIN_CONFIG_DIR` /
`HERDR_SOCKET_PATH` or from `herdr plugin config-dir`, so they are operator-controlled — hence Low,
not a privilege boundary.

Add a matching helper near the other small helpers (e.g. beside `Assert-LastExit`) and use it for
all three values:

```powershell
# Windows passes one command line, not an argv, so each value must survive CommandLineToArgvW's
# re-split. Quote it, escape embedded quotes, and double only the backslashes that precede a quote.
function Format-CommandArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}
```

Then:

```powershell
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File {0} -TaskConfigDir {1} -TaskSocketPath {2} _exec-bridge' -f
  (Format-CommandArgument $ctl),
  (Format-CommandArgument $script:ConfigDir),
  (Format-CommandArgument $script:SocketPath)
```

Note the `"` are gone from the format string — the helper adds them only when needed.

Keep `Set-StrictMode -Version Latest` happy: declare the helper before `Register-CollieTask` uses
it, and use the `[string]` parameter type as written.

### Verify

- `bash -n` doesn't apply. Compile check the C# the way the script already does — the ps1's
  `Write-CollieActionLauncher` calls `Add-Type -Path collie-action.cs -OutputAssembly ...`. If you
  have a Windows PowerShell available, run that path once to confirm the file still compiles.
- If you can run PowerShell, sanity check the helper directly:
  `Format-CommandArgument 'C:\a b\c'` → `"C:\a b\c"`;
  `Format-CommandArgument 'C:\plain'` → `C:\plain`;
  `Format-CommandArgument 'a"b'` → `"a\"b"`.
- If neither is available in the build environment, state that in the PR body. Do not claim a check
  you didn't run.

---

## 5. `web/` dev dependencies — deferred, do not action

`bun audit` in `web/` reports 18 findings. All are build/test-time
(`brace-expansion`, `nanoid`, `postcss`, `undici`, `fast-uri`) except `react-router`
GHSA-qwww-vcr4-c8h2, which is RSC server-action-only and does not apply to a client SPA.

Leave it. `bunfig.toml` enforces a 7-day dependency cooldown, so `bun update` here would either
no-op or churn the lockfile for no security gain, and mixing a lockfile bump into a workflow/systemd
PR makes the diff unreviewable. Say in the PR that item 5 is deferred and keep issue #12 open for
it, or open a follow-up issue — the maintainer's call, but don't close #12 as fully done.

---

## Version bump — MANDATORY (see CLAUDE.md → Versioning)

Current version is **0.30.0** in all three files, newest CHANGELOG heading `## [0.30.0] - 2026-08-17`.

Bump to **0.30.1** — PATCH. Every item is the code doing what it was always meant to do: the CI
token was never meant to be write, the service was never meant to be this exposed, the pid guard was
never meant to match another checkout, the launchers were never meant to re-split a path. Nothing
new is available to the operator and nothing they configured has to change.

Bump all three files to `0.30.1`:

- `herdr-plugin.toml`
- `package.json`
- `web/package.json`

Add a CHANGELOG entry under `## [0.30.1] - <today's real date>`. Crisp, one line per change, short
commit hash cited at the end of each line. Land the functional commits first, then cut the release
commit so the hashes exist to cite. Sketch:

```markdown
## [0.30.1] - YYYY-MM-DD

### Changed

- **CI runs with `contents: read` and SHA-pinned actions** — a moved tag can no longer change what CI executes (abc1234)
- **The systemd unit is confined** — kernel/cgroup/SUID/realtime restrictions, `SystemCallArchitectures=native`, an address-family allow-list and `UMask=0077`; `MemoryDenyWriteExecute` stays off (Bun's JIT) (abc1234)
- **Generated unit values are quoted** — a checkout or config path containing a space no longer truncates `Environment=` / `ExecStart=` (abc1234)

### Fixed

- **The pidfile kill matches this checkout's absolute path** — a recycled pid running another checkout's `bridge/index.ts` is no longer killed on `start` (abc1234)
- **Windows launchers quote each argument** — a path with a space or a quote no longer re-splits into the wrong arguments (abc1234)
```

Then run `bash scripts/check-version.sh` — it must print `✓`.

---

## Full verification checklist

Run from the repo root. Judge each by its exit status, not by scanning output for the word "error".

1. `bash -n scripts/collie-ctl.sh`
2. `bash scripts/check-version.sh` → prints `✓`
3. `bun run typecheck`
4. `bun run test` (root — Bun's runner over `bridge/` plus `scripts/collie-ctl.test.sh`, which now
   includes the new pidfile test)
5. `cd web && bun run test` (unchanged by this work, but the pre-push hook runs it)
6. On a Linux host if available: `systemd-analyze verify` on the generated unit, and
   `systemd-analyze security collie`
7. PR CI run goes green with the pinned action SHAs visible in the setup logs

The pre-push hook runs 4 and 5 automatically. Don't reach for `SKIP_TESTS=1`.

---

## Branch and PR

Not a single-file edit, so branch → push → PR:

```bash
git checkout -b hardening/issue-12-ops
# ... functional commits, one per item ...
# ... then the chore(release): 0.30.1 commit ...
git push -u origin hardening/issue-12-ops
gh pr create --title "Ops hardening: CI permissions/pins, systemd confinement, pidfile match, Windows arg quoting" --body "..."
```

PR body must say: closes items 1–4 of #12, item 5 deferred (dependency cooldown, dev-only findings);
which verification commands actually ran and which couldn't (Windows/PowerShell, `systemd-analyze`).

This is the maintainer's own repo, not a fork, so the version bump and CHANGELOG entry belong in the
PR. After merge, push the annotated tag with the release:
`git tag -a v0.30.1 -m "Collie 0.30.1" && git push origin v0.30.1`.

---

## Traps, in one place

- **`MemoryDenyWriteExecute` will break the service.** Bun's JIT. The issue says "test it"; the
  answer is no. Leave the comment saying so.
- **`ProtectHome` will break the journal.** `bridge/journal/` reads agent session logs from under
  `$HOME`, and the config dir is there too. Not on the issue's list — don't add it as a bonus.
- **`ProtectSystem` stays unset.** The existing comment in the unit explains why (the state dir is
  env-driven and can't be enumerated statically). Don't "improve" it.
- **`RestrictAddressFamilies` without `AF_NETLINK` can break DNS.** The bridge makes outbound HTTPS
  calls (update check, web push). If the service misbehaves on the host after this, drop the
  directive rather than guessing at families.
- **Two copies of the unit.** `systemd/collie.service` and the `write_unit()` heredoc. Editing one
  and not the other is the likeliest mistake in this change.
- **The new ctl test must be added to the runner list** at the bottom of
  `scripts/collie-ctl.test.sh`, not just defined.
- **Don't touch `bun.lock` or `web/bun.lock`.**
