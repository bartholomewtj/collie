# Plan: Fix the #66 test suite on Windows — find Git bash, not the WSL stub

## Context

`bun test ./scripts/check-doc-links.test.ts` fails 4 tests on this Windows box. Every test spawns
`["bash", SCRIPT, file]`; PATH's first `bash` is `C:\Windows\System32\bash.exe` — the **WSL stub**.
There is no WSL distro installed, so every spawn prints
`execvpe(/bin/bash) failed: No such file or directory` and exits 1. Git bash IS installed at
`C:\Program Files\Git\bin\bash.exe` (and `C:\Program Files\Git\usr\bin\bash.exe`), but it is behind
the stub in PATH.

The 0.43.1 fix inside `scripts/check-doc-links.sh` itself (the SIGPIPE/`grep -q` pipeline fix that
this suite pins) is correct and **must not be touched**. This is purely a test-runner problem: the
tests pick the wrong bash on win32.

## Change 1 — `scripts/check-doc-links.test.ts`: resolve the bash executable

**Do not touch `scripts/check-doc-links.sh`.**

Add a small module-level resolver and gate the suite on it:

```ts
import { existsSync } from "node:fs";
// (add to the existing bun:test import) test.skipIf — or describe.skipIf

const GIT_BASH_CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
];

/**
 * The bash to run the script with. On win32 PATH's first `bash` is the System32 WSL stub — with
 * no distro installed every spawn dies with `execvpe(/bin/bash) failed: No such file or directory`
 * (#66). Prefer Git bash's well-known locations; if none exists, skip rather than invoke the stub.
 */
function resolveBash(): string | null {
  if (process.platform !== "win32") return "bash";
  for (const p of GIT_BASH_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

const BASH = resolveBash();
```

Then:

- Wrap the existing `describe("check-doc-links.sh", ...)` as
  `describe.skipIf(BASH === null)(...)` — on a Windows box with no Git bash the suite **skips**
  (pass, not fail) instead of spawning the WSL stub. Never invoke System32 bash; never add a WSL
  dependency.
- In the `check()` helper, replace the hard-coded `"bash"` with `BASH`:
  `Bun.spawn([BASH!, SCRIPT, file], ...)`. (Or pass `BASH` as a parameter — either is fine; the
  `!`/non-null is safe because `describe.skipIf` already guarantees it is a string when tests run.)

`Bun.spawn` with an argv array handles the space in `C:\Program Files\...` correctly — no quoting
needed.

## Change 2 — Version bump 0.43.1 → 0.43.2 (PATCH)

This is a test-runner fix so the existing gate actually runs here — PATCH axis. Bump **all three**
to `0.43.2` so they agree:

- `herdr-plugin.toml` — `version = "0.43.2"`
- `package.json` — `"version": "0.43.2"`
- `web/package.json` — `"version": "0.43.2"`

## Change 3 — CHANGELOG entry

Add a new heading above `## [0.43.1]`, real date, one crisp Fixed line citing the test file:

```markdown
## [0.43.2] - YYYY-MM-DD

### Fixed
- `scripts/check-doc-links.test.ts` runs on Windows: it now resolves Git bash directly instead of
  picking the System32 WSL stub from PATH (which dies with no distro installed), and skips when no
  usable bash exists (#66)
```

## Verification

1. `bun test ./scripts/check-doc-links.test.ts` — must exit **0** on this box (all six tests pass;
   they should pass, not skip, since Git bash is installed at `C:\Program Files\Git\bin\bash.exe`).
2. `bash scripts/check-version.sh` — must print `✓`.
3. Full backend suite still green: `bun run test` (or at minimum confirm no other test file spawns a
   bare `bash` — grep showed only `scripts/check-doc-links.test.ts` does).
4. Confirm `scripts/check-doc-links.sh` is unchanged: `git diff --stat scripts/check-doc-links.sh`
   must be empty.

## Commit & close #66

1. Commit the functional change (test file + version bump + CHANGELOG) together — the pre-commit
   version check will pass because all four files agree. Suggested subject:
   `fix(tests): run doc-link tests against Git bash on Windows, not the WSL stub`
2. Close the issue with a comment:
   - The 0.43.1 SIGPIPE/`grep -q` fix in `scripts/check-doc-links.sh` stands — the matching logic is
     unchanged and still pinned by the six tests.
   - The Windows failures were the test runner resolving `bash` to the System32 WSL stub (no distro
     installed → `execvpe(/bin/bash) failed`). The tests now locate Git bash directly
     (`C:\Program Files\Git\bin\bash.exe`, then `usr\bin`) and skip cleanly when no usable bash
     exists. Fixed in 0.43.2.

   Command shape:
   `gh issue close 66 --comment "<the above, condensed>"`

## Out of scope

- Rewriting `check-doc-links.sh` (the 0.43.1 fix stays exactly as it is)
- Cutting 0.44.0, `quality.py`, screenshots, any other issue
- Invoking System32 bash or adding a WSL dependency
