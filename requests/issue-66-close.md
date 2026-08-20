Fix the #66 test suite on Windows so `bun test ./scripts/check-doc-links.test.ts` is green (pass or skip, not fail), then close GitHub issue #66.

The 0.43.1 SIGPIPE/`grep -q` fix in scripts/check-doc-links.sh stays. Do not rewrite that script's matching logic.

The look: four tests fail because the file invokes `bash`, and on this box PATH's bash is `C:\Windows\System32\bash.exe` (the WSL stub). There is no distro, so every spawn prints `execvpe(/bin/bash) failed: No such file or directory` and exits 1. Git bash is installed at `C:\Program Files\Git\bin\bash.exe` and `C:\Program Files\Git\usr\bin\bash.exe`. `where.exe bash` lists the WSL stub first.

Where: scripts/check-doc-links.test.ts. Point the tests at Git bash on win32 (not System32), or skipIf when the only bash is the WSL stub. Do not change scripts/check-doc-links.sh.

Done means: `bun test ./scripts/check-doc-links.test.ts` exits 0 on this Windows box. `gh issue close 66` with a comment that the 0.43.1 SIGPIPE fix stands and the tests now find Git bash (or skip) instead of the WSL stub. PATCH bump: this is a test-runner fix so the existing gate actually runs here — 0.43.1 → 0.43.2 in herdr-plugin.toml, package.json, web/package.json, and a CHANGELOG Fixed line citing the test file.

Out of scope: rewriting check-doc-links.sh, cutting 0.44.0, quality.py, screenshots, other issues. Do not invoke System32 bash. Do not add a WSL dependency.
