"""#103 / #106 — out-of-scope denylist on permitted() / enforce()."""
from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from adw_modules.data_types import AgentConfig, PromptEngineering, SSSFConfig
from adw_modules import permissions


def _agent(*, writes):
    return AgentConfig(
        name="builder",
        prompt_engineering=PromptEngineering(system="x", user="y"),
        writes=writes,
    )


def _cfg():
    return SSSFConfig()


class _Console:
    def note(self, *_a, **_k):
        return None


class _Run:
    def __init__(self, denied):
        self.cfg = _cfg()
        self.repo_root = Path(".")
        self.out_of_scope = denied
        self.console = _Console()


class PermittedDenylist(unittest.TestCase):
    def test_named_file_under_allowed_dir_is_denied(self):
        # Builder allowed web/ rewrites web/src/routes/detail.tsx; request
        # named `routes/detail.tsx` under Out of scope.
        agent = _agent(writes=["web/"])
        self.assertFalse(permissions.permitted(
            "web/src/routes/detail.tsx", agent, _cfg(),
            denied=["routes/detail.tsx"]))

    def test_unnamed_file_under_allowed_dir_still_passes(self):
        agent = _agent(writes=["web/"])
        self.assertTrue(permissions.permitted(
            "web/src/components/space-tree.tsx", agent, _cfg(),
            denied=["routes/detail.tsx"]))

    def test_unrestricted_builder_still_blocked_on_named_file(self):
        agent = _agent(writes=None)
        self.assertFalse(permissions.permitted(
            "web/src/routes/detail.tsx", agent, _cfg(),
            denied=["routes/detail.tsx"]))
        self.assertTrue(permissions.permitted(
            "web/src/components/space-tree.tsx", agent, _cfg(),
            denied=["routes/detail.tsx"]))

    def test_always_writable_session_runtime_is_not_blocked(self):
        agent = _agent(writes=["web/"])
        runtime = "adws/adw_data/sessions/abcd/builder/envelope.json"
        self.assertTrue(permissions.permitted(
            runtime, agent, _cfg(), denied=["routes/detail.tsx"]))
        self.assertTrue(permissions.permitted(
            runtime, agent, _cfg(), denied=None))

    def test_none_fail_closed_blocks_in_scope_write(self):
        agent = _agent(writes=["web/"])
        self.assertFalse(permissions.permitted(
            "web/src/components/space-tree.tsx", agent, _cfg(), denied=None))

    def test_empty_list_is_a_noop(self):
        agent = _agent(writes=["web/"])
        self.assertTrue(permissions.permitted(
            "web/src/components/space-tree.tsx", agent, _cfg(), denied=[]))

    def test_writes_allowlist_does_not_suffix_match(self):
        # Suffix match is denylist-only. Naming config.ts in writes: does
        # not unlock every */config.ts.
        agent = _agent(writes=["config.ts"])
        self.assertFalse(permissions.permitted(
            "bridge/config.ts", agent, _cfg(), denied=[]))
        self.assertTrue(permissions.permitted(
            "config.ts", agent, _cfg(), denied=[]))


class EnforceDenylist(unittest.TestCase):
    def _run_enforce(self, denied, writes, path):
        run = _Run(denied)
        agent = _agent(writes=writes)
        before = {permissions.HEAD_KEY: "abc"}
        after = {permissions.HEAD_KEY: "abc", path: "1,0"}
        with patch.object(permissions, "snapshot", return_value=after), \
             patch.object(permissions, "_uncommit", return_value=None), \
             patch.object(permissions, "_roll_back", return_value="rolled back") as rb:
            try:
                touched = permissions.enforce(run, None, agent, before)
            except permissions.PermissionBreach:
                self.assertTrue(rb.called)
                raise
            rb.assert_not_called()
            return touched

    def test_named_file_is_a_breach_and_rolls_back(self):
        with self.assertRaises(permissions.PermissionBreach) as caught:
            self._run_enforce(
                ["routes/detail.tsx"], ["web/"], "web/src/routes/detail.tsx")
        self.assertIn("web/src/routes/detail.tsx", str(caught.exception))

    def test_unnamed_file_under_writes_is_allowed(self):
        touched = self._run_enforce(
            ["routes/detail.tsx"], ["web/"],
            "web/src/components/space-tree.tsx")
        self.assertEqual(touched, ["web/src/components/space-tree.tsx"])

    def test_none_fail_closed_on_web_write(self):
        with self.assertRaises(permissions.PermissionBreach) as caught:
            self._run_enforce(None, ["web/"], "web/src/components/space-tree.tsx")
        self.assertIn("never captured", str(caught.exception))

    def test_empty_list_allows_web_write(self):
        touched = self._run_enforce(
            [], ["web/"], "web/src/components/space-tree.tsx")
        self.assertEqual(touched, ["web/src/components/space-tree.tsx"])


class CaptureOnLog(unittest.TestCase):
    def test_engineer_input_sets_a_list(self):
        from adw_modules.data_types import Phase, PhaseParams
        from adw_modules.runner import PhaseHandle, Run

        class _Tracer:
            def event(self, *_a, **_k):
                return None

            def session_request(self, *_a, **_k):
                return None

            def max_phase_seq(self, *_a, **_k):
                return 0

            def completed_envelopes(self, *_a, **_k):
                return {}

        class _Cfg:
            class defaults:
                data_dir = "adws/adw_data"

        run = Run.__new__(Run)
        run.adw_id = "test"
        run.tracer = _Tracer()
        run.console = _Console()
        run.out_of_scope = None
        phase = Phase(
            phase_id="p", adw_id="test", seq=1,
            params=PhaseParams(name="request", kind="engineer", owner="bart",
                               description="Capture the incoming ask"),
        )
        PhaseHandle(run, phase).log(input=ISSUE_67_SNIPPET)
        self.assertEqual(run.out_of_scope, ["routes/detail.tsx"])

    def test_parse_raise_leaves_unset(self):
        from adw_modules.data_types import Phase, PhaseParams
        from adw_modules.runner import PhaseHandle

        class _Tracer:
            def event(self, *_a, **_k):
                return None

            def session_request(self, *_a, **_k):
                raise AssertionError("session_request must not run if parse raises")

        run = type("R", (), {})()
        run.adw_id = "test"
        run.tracer = _Tracer()
        run.console = _Console()
        run.out_of_scope = None
        phase = Phase(
            phase_id="p", adw_id="test", seq=1,
            params=PhaseParams(name="request", kind="engineer", owner="bart",
                               description="Capture the incoming ask"),
        )
        with patch("adw_modules.runner.quality_scope.parse_out_of_scope",
                   side_effect=ValueError("boom")):
            with self.assertRaises(ValueError):
                PhaseHandle(run, phase).log(input="Out of scope: x")
        self.assertIsNone(run.out_of_scope)


ISSUE_67_SNIPPET = """
Out of scope: The pane screen itself (`routes/detail.tsx`) beyond its one back-target line.
"""


if __name__ == "__main__":
    unittest.main()
