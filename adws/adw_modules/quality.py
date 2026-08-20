"""Deterministic typecheck, test, version, and build blocks.

A known command is not a judgement call. Anything whose invocation you can write
down belongs here as code — it runs in milliseconds, costs nothing, and returns
the same answer every time. Agents are for the parts that need reading and
deciding.

╔══════════════════════════════════════════════════════════════════════════════╗
║  COLLIE'S BLOCKS ARE WIRED. Keep them that way.                              ║
║                                                                              ║
║  This file ships from the skill with every block as an `echo` that exits 0    ║
║  and announces it is fake, so a stamped repo can't mistake an unconfigured    ║
║  gate for a passing one. Nobody replaced them here, and for every run up to   ║
║  2026-08-20 the quality phase printed "Placeholder quality check for test",   ║
║  exited 0 in 0.0s, and the chain committed on that (#60). One of those runs   ║
║  shipped a pane screen that crashed on open. The blocks below are now the     ║
║  real commands. If you ever see `Placeholder` in a trace again, this file     ║
║  was reverted — that is the bug, not the run.                                 ║
║                                                                              ║
║  Two rules when you change a command:                                        ║
║    1. argv LIST, never a shell string — no quoting bugs, no shell injection.  ║
║    2. Call binaries by BARE NAME. These blocks inherit the operator's         ║
║       environment (see utils.operator_env), so `bun` resolves exactly as it   ║
║       does in their terminal. Never hard-code an absolute path like           ║
║       /Users/you/.bun/bin/bun — that bakes your machine into the trace.       ║
║                                                                              ║
║  There is no lint block: eslint is not a dependency. The harness network-API  ║
║  fence is a Vitest test (`web/src/lib/harness/fence.test.ts`).                ║
║                                                                              ║
║  `build` is in run_quality() only, never the SDLC inner loop. It rewrites     ║
║  gitignored web/dist. On this checkout the bridge serves that dist live.      ║
║                                                                              ║
║  This file is REPO-OWNED. A fleet box refresh replaces every other module    ║
║  from the skill but keeps your quality.py, so these commands survive.        ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import json
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

from .data_types import (EventRecord, QualityCheckResult, QualityCheckSpec, QualityResult,
                         VerifyOutput)
from .utils import now_iso, operator_env

# How much of a failing command's output rides back inside the envelope. Enough
# for a builder to act on without opening the artifact; bounded so a runaway
# stack trace can't swamp the next agent's context.
TAIL_CHARS = 4_000

# Same functional-path set as scripts/git-hooks/pre-commit. A fleet box has no
# core.hooksPath, so the bump check has to live here or it never runs (#74).
_FUNCTIONAL_RE = re.compile(
    r"^(bridge/|web/src/|web/public/|web/vite\.config\.ts|web/index\.html|"
    r"web/package\.json|scripts/|systemd/|package\.json|herdr-plugin\.toml)"
)
_TOML_VERSION_RE = re.compile(r'^\s*version\s*=\s*"([^"]+)"')
_CHANGELOG_VERSION_RE = re.compile(r"^##\s*\[([0-9][^\]]*)\]")


def _check_dir(run, name: str) -> Path:
    seq = run.phases[-1].seq if run.phases else 0
    path = run.context_handoff_dir / "quality" / f"{seq:02d}_{name}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _finish(run, *, name: str, area: str, operation: str, command: str,
            returncode: int, stdout: str, stderr: str, duration: float,
            started_at: str) -> QualityCheckResult:
    phase = run.phases[-1]
    output_artifact = _check_dir(run, name) / "command.log"
    output_artifact.write_text(
        f"$ {command}\nexit: {returncode}\nduration_seconds: {duration:.3f}\n"
        f"\n--- stdout ---\n{stdout}\n--- stderr ---\n{stderr}\n"
    )
    passed = returncode == 0
    run.tracer.event(EventRecord(
        adw_id=run.adw_id,
        phase_id=phase.phase_id,
        type="tool_call",
        name=f"quality:{name}",
        payload={
            "area": area,
            "operation": operation,
            "command": command,
            "returncode": returncode,
            "passed": passed,
            "output_artifact": str(output_artifact),
        },
        started_at=started_at,
        ended_at=now_iso(),
    ))
    run.console.note(
        f"quality {name}: {'passed' if passed else 'failed'} "
        f"(exit {returncode}, {duration:.1f}s)"
    )
    return QualityCheckResult(
        name=name,
        area=area,
        operation=operation,
        command=command,
        returncode=returncode,
        passed=passed,
        duration_seconds=duration,
        output_artifact=str(output_artifact),
        output_tail=(stdout + stderr)[-TAIL_CHARS:],
    )


def _run(spec: QualityCheckSpec, run) -> QualityCheckResult:
    command = shlex.join(spec.argv)
    env = operator_env()             # the engineer's own shell environment

    run.console.note(f"quality {spec.name}: {command}")
    started_at = now_iso()
    clock = time.monotonic()
    stdout = ""
    stderr = ""
    try:
        completed = subprocess.run(
            spec.argv,
            cwd=run.repo_root,
            env=env,
            capture_output=True,
            text=True,
            timeout=spec.timeout_seconds,
        )
        returncode = completed.returncode
        stdout = completed.stdout
        stderr = completed.stderr
    except subprocess.TimeoutExpired as error:
        returncode = 124
        stdout = error.stdout or ""
        stderr = (error.stderr or "") + f"\nTimed out after {spec.timeout_seconds}s."
    except OSError as error:
        # A missing binary lands here as exit 127 with the real message — no
        # pre-flight probe needed, and none wanted.
        returncode = 127
        stderr = str(error)

    return _finish(
        run,
        name=spec.name,
        area=spec.area,
        operation=spec.operation,
        command=command,
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
        duration=time.monotonic() - clock,
        started_at=started_at,
    )


def _logic(run, *, name: str, area: str, operation: str, command: str,
           passed: bool, stdout: str, stderr: str = "") -> QualityCheckResult:
    """A check that is Python, not a subprocess — still a traced quality result."""
    run.console.note(f"quality {name}: {command}")
    started_at = now_iso()
    return _finish(
        run,
        name=name,
        area=area,
        operation=operation,
        command=command,
        returncode=0 if passed else 1,
        stdout=stdout,
        stderr=stderr,
        duration=0.0,
        started_at=started_at,
    )


def _collect(run, blocks: list[Callable]) -> QualityResult:
    checks = list(_ensure_installs(run))
    checks.extend(block(run) for block in blocks)
    failures = [
        f"{check.name}: `{check.command}` exited {check.returncode}\n{check.output_tail}".rstrip()
        for check in checks if not check.passed
    ]
    return QualityResult(
        passed=not failures,
        checks=checks,
        failures=failures,
        artifacts=[check.output_artifact for check in checks],
    )


def _ensure_installs(run) -> list[QualityCheckResult]:
    """Fleet boxes get a git bundle, not node_modules. Host checkouts already have them."""
    checks: list[QualityCheckResult] = []
    root = Path(run.repo_root)
    if not (root / "node_modules").exists():
        checks.append(_run(QualityCheckSpec(
            name="install_bridge",
            area="backend",
            operation="build",
            argv=["bun", "install", "--frozen-lockfile"],
            timeout_seconds=300,
        ), run))
    if not (root / "web" / "node_modules").exists():
        checks.append(_run(QualityCheckSpec(
            name="install_web",
            area="frontend",
            operation="build",
            argv=["bun", "install", "--frozen-lockfile", "--cwd", "web"],
            timeout_seconds=300,
        ), run))
    return checks


def _toml_version(path: Path) -> str | None:
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        match = _TOML_VERSION_RE.match(line)
        if match:
            return match.group(1)
    return None


def _json_version(path: Path) -> str | None:
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8")).get("version")
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, str) else None


def _changelog_version(path: Path) -> str | None:
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        match = _CHANGELOG_VERSION_RE.match(line)
        if match:
            return match.group(1)
    return None


def _semver_tuple(version: str) -> tuple[int, ...]:
    core = version.split("-", 1)[0].split("+", 1)[0]
    parts: list[int] = []
    for piece in core.split("."):
        try:
            parts.append(int(piece))
        except ValueError:
            parts.append(0)
    return tuple(parts)


def _git_cwd(run, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=run.repo_root,
        capture_output=True,
        text=True,
    )


# ── Blocks ────────────────────────────────────────────────────────────────────
# Collie is two codebases in one repo: the Bun bridge (bridge/, scripts/) and the
# React PWA (web/). Both need their own suite AND their own typecheck, because
# Vite strips types without checking them — a type error builds clean and ships.
# Everything runs from the repo root, so the web blocks use `bun run --cwd web`
# (flag AFTER `run`; `bun --cwd web run …` silently lists scripts instead).
#
# QualityOperation has no "test" value (data_types.py is not repo-owned), so
# test blocks use operation="build" and name= to say what they are.


def typecheck_bridge(run) -> QualityCheckResult:
    """Bridge + scripts types (root tsconfig, which has noUncheckedIndexedAccess)."""
    return _run(QualityCheckSpec(
        name="typecheck_bridge",
        area="backend",
        operation="typecheck",
        argv=["bun", "run", "typecheck"],
        timeout_seconds=300,
    ), run)


def typecheck_web(run) -> QualityCheckResult:
    """App + service-worker tsconfigs. Vite does not typecheck."""
    return _run(QualityCheckSpec(
        name="typecheck_web",
        area="frontend",
        operation="typecheck",
        argv=["bun", "run", "--cwd", "web", "typecheck"],
        timeout_seconds=300,
    ), run)


def test_bridge(run) -> QualityCheckResult:
    """Bridge + scripts suites. Fast, hermetic, no side effects on the tree.

    Deliberately not the root `bun run test`: that also runs the collie-ctl
    lifecycle suite, which on Windows exits 0 as a skip. ctl is its own block.
    """
    return _run(QualityCheckSpec(
        name="test_bridge",
        area="backend",
        operation="build",
        argv=["bun", "test", "./bridge", "./scripts"],
        timeout_seconds=600,
    ), run)


def test_web(run) -> QualityCheckResult:
    """Vitest only. Typecheck is the typecheck_web block, so a failure keeps its own tail."""
    return _run(QualityCheckSpec(
        name="test_web",
        area="frontend",
        operation="build",
        argv=["bun", "run", "--cwd", "web", "vitest", "run"],
        timeout_seconds=900,
    ), run)


def test_ctl(run) -> QualityCheckResult:
    """Lifecycle suite for the platform this process is actually on."""
    if sys.platform == "win32":
        argv = [
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", "contrib/windows/collie-ctl.test.ps1",
        ]
    else:
        argv = ["bash", "scripts/collie-ctl.test.sh"]
    return _run(QualityCheckSpec(
        name="test_ctl",
        area="backend",
        operation="build",
        argv=argv,
        timeout_seconds=180,
    ), run)


def versions(run) -> QualityCheckResult:
    """The four version sources must agree. Same invariant as scripts/check-version.sh."""
    root = Path(run.repo_root)
    toml_v = _toml_version(root / "herdr-plugin.toml")
    pkg_v = _json_version(root / "package.json")
    web_v = _json_version(root / "web" / "package.json")
    log_v = _changelog_version(root / "CHANGELOG.md")
    lines = [
        f"  {'herdr-plugin.toml':<18} {toml_v or '<missing>'}  (canonical)",
        f"  {'package.json':<18} {pkg_v or '<missing>'}",
        f"  {'web/package.json':<18} {web_v or '<missing>'}",
        f"  {'CHANGELOG.md':<18} {log_v or '<missing>'}",
    ]
    if not toml_v:
        stdout = "✗ could not read version from herdr-plugin.toml\n" + "\n".join(lines)
        return _logic(run, name="versions", area="backend", operation="lint",
                      command="versions", passed=False, stdout=stdout)
    if pkg_v != toml_v or web_v != toml_v or log_v != toml_v:
        stdout = (
            "✗ version mismatch — all four must equal the canonical "
            "herdr-plugin.toml version:\n"
            + "\n".join(lines)
            + "\n  → bump all three files to the same version and add a matching CHANGELOG entry."
        )
        return _logic(run, name="versions", area="backend", operation="lint",
                      command="versions", passed=False, stdout=stdout)
    stdout = (
        f"✓ version {toml_v} consistent across manifest, package.json, "
        "web/package.json, CHANGELOG"
    )
    return _logic(run, name="versions", area="backend", operation="lint",
                  command="versions", passed=True, stdout=stdout)


def version_bump(run) -> QualityCheckResult:
    """Functional paths changed ⇒ herdr-plugin.toml version must differ from HEAD.

    The pre-commit hook does this, but a sandbox clone has no core.hooksPath
    (#74 shipped a functional change at a already-pushed tag).
    """
    head = _git_cwd(run, "rev-parse", "--verify", "--quiet", "HEAD")
    if head.returncode != 0:
        return _logic(run, name="version_bump", area="backend", operation="lint",
                      command="version_bump", passed=True,
                      stdout="✓ no HEAD — nothing to compare")

    diff = _git_cwd(run, "diff", "HEAD", "--name-only")
    extra = _git_cwd(run, "ls-files", "--others", "--exclude-standard")
    if diff.returncode != 0:
        return _logic(run, name="version_bump", area="backend", operation="lint",
                      command="version_bump", passed=False,
                      stdout="", stderr=diff.stderr.strip() or "git diff HEAD --name-only failed")

    changed = []
    for line in (*diff.stdout.splitlines(), *extra.stdout.splitlines()):
        path = line.strip().replace("\\", "/")
        if path and _FUNCTIONAL_RE.match(path):
            changed.append(path)
    # unique, stable order
    changed = list(dict.fromkeys(changed))

    root = Path(run.repo_root)
    cur = _toml_version(root / "herdr-plugin.toml")
    shown = _git_cwd(run, "show", "HEAD:herdr-plugin.toml")
    prev = None
    if shown.returncode == 0:
        for line in shown.stdout.splitlines():
            match = _TOML_VERSION_RE.match(line)
            if match:
                prev = match.group(1)
                break

    if cur and prev and _semver_tuple(cur) < _semver_tuple(prev):
        stdout = (
            f"✗ version went backwards ({prev} → {cur}). "
            "The new version must be greater than the last."
        )
        return _logic(run, name="version_bump", area="backend", operation="lint",
                      command="version_bump", passed=False, stdout=stdout)

    if not changed:
        stdout = "✓ no functional paths changed — version bump not required"
        return _logic(run, name="version_bump", area="backend", operation="lint",
                      command="version_bump", passed=True, stdout=stdout)

    if not cur:
        stdout = "✗ could not read version from herdr-plugin.toml"
        return _logic(run, name="version_bump", area="backend", operation="lint",
                      command="version_bump", passed=False, stdout=stdout)

    if prev is None or cur != prev:
        stdout = (
            f"✓ version {cur} differs from HEAD ({prev or 'none'}) "
            f"with {len(changed)} functional path(s) changed"
        )
        return _logic(run, name="version_bump", area="backend", operation="lint",
                      command="version_bump", passed=True, stdout=stdout)

    listed = ", ".join(changed[:40])
    extra_n = len(changed) - 40
    if extra_n > 0:
        listed += f" (+{extra_n} more)"
    stdout = (
        f"✗ functional code changed but the version is still {cur}.\n"
        "  Bump version in herdr-plugin.toml, package.json, web/package.json "
        "and add a CHANGELOG entry.\n"
        f"  Changed: {listed}"
    )
    return _logic(run, name="version_bump", area="backend", operation="lint",
                  command="version_bump", passed=False, stdout=stdout)


def build(run) -> QualityCheckResult:
    """Typecheck both sides, then Vite. Rewrites gitignored web/dist — live on this host."""
    return _run(QualityCheckSpec(
        name="build",
        area="frontend",
        operation="build",
        argv=["bun", "run", "build"],
        timeout_seconds=300,
    ), run)


def run_tests(run) -> QualityResult:
    """The test suite alone, as a QualityResult — the deterministic test phase.

    This is what replaces a `tester` agent once the command is written down. An
    agent rediscovering the runner on every run costs a fortune to learn what a
    subprocess already knows; the repair loop is unchanged, because a failure
    still reaches the builder through `as_envelope` below.
    """
    return _collect(run, [
        typecheck_bridge,
        typecheck_web,
        test_bridge,
        test_web,
    ])


def as_envelope(result: QualityResult, what: str) -> VerifyOutput:
    """Wrap a deterministic result so an agent can be handed it directly.

    Agents hand each other typed envelopes; code blocks return QualityResult.
    This is the adapter, so a failing lint or test run flows back into the
    builder through exactly the same door an agent's report would — the ADW
    script is the only thing that knows the difference.
    """
    return VerifyOutput(
        status="success" if result.passed else "fail",
        summary=(f"{what}: all {len(result.checks)} check(s) passed" if result.passed
                 else f"{what}: {len(result.failures)} of {len(result.checks)} check(s) failed"),
        artifacts=result.artifacts,
        notes_for_next_agent=("" if result.passed else
                              "Fix every failure below. The output is verbatim from the "
                              "command — trust it over any summary."),
        passed=result.passed,
        failures=result.failures,
    )


def run_quality(run) -> QualityResult:
    """Run every block and collect ALL failures — one pass tells you everything.

    Ordering contract for the caller: a failing block does NOT fail the phase.
    The runner did its job; the CODE is what failed. Hand this result to the
    builder and let the bounded repair loop decide the run's fate.
    """
    return _collect(run, [
        versions,
        version_bump,
        typecheck_bridge,
        typecheck_web,
        test_bridge,
        test_web,
        test_ctl,
        build,
    ])
