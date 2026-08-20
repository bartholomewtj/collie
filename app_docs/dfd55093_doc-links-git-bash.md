# Windows Git Bash Resolution in Doc Links Test Suite

## What Changed

`scripts/check-doc-links.test.ts` was updated to explicitly resolve Git Bash paths on Windows instead of relying on the ambient `PATH` lookup for `bash`.

### Background and Problem

On Windows environments without a configured WSL distribution, `C:\Windows\System32\bash.exe` (the Windows Subsystem for Linux launcher stub) is often ordered before Git Bash in the system `PATH`. When `Bun.spawn(["bash", ...])` executed, it spawned the WSL stub, failing immediately with:

```text
execvpe(/bin/bash) failed: No such file or directory
```

This caused four tests in `scripts/check-doc-links.test.ts` to fail during local Windows test runs even though Git Bash was installed and available.

### Solution

1. **Explicit Bash Resolution (`resolveBash`)**:
   - On non-Windows platforms, defaults to bare `"bash"`.
   - On `win32`, checks standard Git Bash install candidate paths:
     - `C:\Program Files\Git\bin\bash.exe`
     - `C:\Program Files\Git\usr\bin\bash.exe`
   - Returns the resolved path or `null` if no valid candidate exists.
2. **Conditional Suite Execution**:
   - Gated the test suite with `describe.skipIf(BASH === null)("check-doc-links.sh", ...)` so test runs skip cleanly when no usable Bash environment is present rather than invoking the WSL stub.
3. **Execution Invocation**:
   - Updated the `check()` test helper to invoke `Bun.spawn([BASH!, SCRIPT, file], ...)`.
4. **Release Bump & Changelog**:
   - Bumped the patch version to `0.43.2` across `herdr-plugin.toml`, `package.json`, and `web/package.json`.
   - Added a corresponding `[0.43.2]` entry in `CHANGELOG.md` under `Fixed` referencing issue #66.

## Changed Files

- `scripts/check-doc-links.test.ts`: Added `resolveBash` resolution logic, candidate path search, and `describe.skipIf` gating.
- `herdr-plugin.toml`: Bumped version `0.43.1` → `0.43.2`.
- `package.json`: Bumped version `0.43.1` → `0.43.2`.
- `web/package.json`: Bumped version `0.43.1` → `0.43.2`.
- `CHANGELOG.md`: Added release notes for `0.43.2` documenting the Windows Git Bash test fix.
- `specs/dfd55093_doc-links-tests-git-bash.md`: Plan specification for resolving issue #66.

## Verification

To verify the test suite:

```bash
bun test ./scripts/check-doc-links.test.ts
```

All 6 test cases in `scripts/check-doc-links.test.ts` pass when Git Bash is present, or skip cleanly if no Git Bash candidate is installed.

To verify version consistency:

```bash
bash scripts/check-version.sh
```
