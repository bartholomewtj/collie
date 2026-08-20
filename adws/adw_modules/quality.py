"""Deterministic lint, typecheck, build, and test blocks.

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
║  And one rule about what may go in: a quality block MUST NOT have side        ║
║  effects on the checkout. `bun run build` is deliberately absent — it         ║
║  rewrites web/dist, which IS the deployment on a host that serves from this   ║
║  tree, so a gate that ran it would publish whatever the builder had in the    ║
║  working tree mid-run. Typecheck already covers what the bundler would        ║
║  catch.                                                                       ║
║                                                                              ║
║  This file is REPO-OWNED. A fleet box refresh replaces every other module    ║
║  from the skill but keeps your quality.py, so these commands survive.        ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import shlex
import subprocess
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


def _check_dir(run, name: str) -> Path:
    seq = run.phases[-1].seq if run.phases else 0
    path = run.context_handoff_dir / "quality" / f"{seq:02d}_{name}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _run(spec: QualityCheckSpec, run) -> QualityCheckResult:
    phase = run.phases[-1]
    output_dir = _check_dir(run, spec.name)
    output_artifact = output_dir / "command.log"
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

    duration = time.monotonic() - clock
    output_artifact.write_text(
        f"$ {command}\nexit: {returncode}\nduration_seconds: {duration:.3f}\n"
        f"\n--- stdout ---\n{stdout}\n--- stderr ---\n{stderr}\n"
    )
    passed = returncode == 0
    run.tracer.event(EventRecord(
        adw_id=run.adw_id,
        phase_id=phase.phase_id,
        type="tool_call",
        name=f"quality:{spec.name}",
        payload={
            "area": spec.area,
            "operation": spec.operation,
            "command": command,
            "returncode": returncode,
            "passed": passed,
            "output_artifact": str(output_artifact),
        },
        started_at=started_at,
        ended_at=now_iso(),
    ))
    run.console.note(
        f"quality {spec.name}: {'passed' if passed else 'failed'} "
        f"(exit {returncode}, {duration:.1f}s)"
    )
    return QualityCheckResult(
        name=spec.name,
        area=spec.area,
        operation=spec.operation,
        command=command,
        returncode=returncode,
        passed=passed,
        duration_seconds=duration,
        output_artifact=str(output_artifact),
        output_tail=(stdout + stderr)[-TAIL_CHARS:],
    )


# ── Blocks ────────────────────────────────────────────────────────────────────
# Collie is two codebases in one repo: the Bun bridge (bridge/, scripts/) and the
# React PWA (web/). Both need their own suite AND their own typecheck, because
# Vite strips types without checking them — a type error builds clean and ships.
# Everything runs from the repo root, so the web blocks use `bun run --cwd web`
# (flag AFTER `run`; `bun --cwd web run …` silently lists scripts instead).
#
# There is no `lint` block: this repo has no linter configured. There is no
# `build` block on purpose — see the banner.

def test(run) -> QualityCheckResult:
    """The bridge + scripts suites. Fast, hermetic, no side effects on the tree.

    Deliberately not the root `bun run test`: that also runs the collie-ctl
    lifecycle suite, which drives service lifecycle in a sandbox. The pre-push
    hook owns that one; a quality gate should not be starting and stopping
    services.
    """
    return _run(QualityCheckSpec(
        name="test",
        area="backend",
        operation="build",
        argv=["bun", "test", "./bridge", "./scripts"],
        timeout_seconds=600,
    ), run)


def typecheck(run) -> QualityCheckResult:
    """Bridge + scripts types (root tsconfig, which has noUncheckedIndexedAccess)."""
    return _run(QualityCheckSpec(
        name="typecheck",
        area="backend",
        operation="typecheck",
        argv=["bun", "run", "typecheck"],
        timeout_seconds=300,
    ), run)


def web_test(run) -> QualityCheckResult:
    """The Vitest suite. Since 0.41.1 web's `test` script typechecks first, so
    this block covers both the app and service-worker tsconfigs as well."""
    return _run(QualityCheckSpec(
        name="web_test",
        area="frontend",
        operation="build",
        argv=["bun", "run", "--cwd", "web", "test"],
        timeout_seconds=900,
    ), run)


def run_tests(run) -> QualityResult:
    """The test suite alone, as a QualityResult — the deterministic test phase.

    This is what replaces a `tester` agent once the command is written down. An
    agent rediscovering the runner on every run costs a fortune to learn what a
    subprocess already knows; the repair loop is unchanged, because a failure
    still reaches the builder through `as_envelope` below.
    """
    checks = [test(run), web_test(run)]
    failures = [
        f"{check.name}: `{check.command}` exited {check.returncode}\n"
        f"{check.output_tail}".rstrip()
        for check in checks if not check.passed
    ]
    return QualityResult(passed=not failures, checks=checks, failures=failures,
                         artifacts=[check.output_artifact for check in checks])


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
    blocks: list[Callable] = [
        test,
        typecheck,
        web_test,
    ]
    checks = [block(run) for block in blocks]
    # A failure is the command, its exit code, and what it actually printed —
    # everything a builder needs to repair without opening a log or being told
    # what the error "means" by a parser that guessed.
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
