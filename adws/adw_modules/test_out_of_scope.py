"""#104 — named Out of scope: files vs a change-set. Parser + match contract.

Python unittest, not bun/`uv`, not part of `bun test ./scripts`:

    PYTHONPATH=adws python3 -m unittest adw_modules.test_out_of_scope
"""
from __future__ import annotations

import unittest

from adw_modules.quality_scope import parse_out_of_scope, scope_breaches


# The #67 request shape that shipped a crashed pane: the builder rewrote the
# file the request named in backticks, and nothing flagged it.
ISSUE_67 = """
Replace Herd and the space detail screen with one Spaces tree.

Done means: `/` shows the tree.

Out of scope: The pane screen itself (`routes/detail.tsx`) beyond its one back
-target line. The traces screens. Settings.
"""

ISSUE_82 = """
Stop the spaces list rearranging itself.

Out of scope: filter-by-query behaviour, blocked badge/colour visuals, auto-expand of blocked spaces, bridge/, Herdr, sortSpacesByRecency's own unit tests except callers of the tree, adws/, other issues, docs PRs #84/#86.
"""


class ParseOutOfScope(unittest.TestCase):
    def test_no_section(self):
        self.assertEqual(parse_out_of_scope("just do the thing"), [])

    def test_empty_request(self):
        self.assertEqual(parse_out_of_scope(""), [])

    def test_issue_67_extracts_backtick_path_not_bare_filename(self):
        names = parse_out_of_scope(ISSUE_67)
        self.assertEqual(names, ["routes/detail.tsx"])
        self.assertNotIn("detail.tsx", names)

    def test_issue_82_extracts_dirs_not_prose(self):
        names = parse_out_of_scope(ISSUE_82)
        self.assertIn("bridge/", names)
        self.assertIn("adws/", names)
        self.assertNotIn("Herdr", names)
        self.assertNotIn("badge/colour", names)
        self.assertNotIn("filter-by-query", names)
        self.assertNotIn("filter-by-query behaviour", names)
        joined = " ".join(names)
        self.assertNotRegex(joined, r"#84")

    def test_bare_file_with_extension(self):
        names = parse_out_of_scope("Out of scope: quality.py, the rest of the app.")
        self.assertEqual(names, ["quality.py"])

    def test_heading_form_then_paragraph(self):
        request = (
            "## Out of scope\n\n"
            "The pane screen itself (`routes/detail.tsx`) beyond its one back\n"
            "-target line. Any change to `lib/triage.ts`'s classifier. "
            "The two dirty files `AGENTS.md` and `GEMINI.md`.\n"
        )
        names = parse_out_of_scope(request)
        self.assertIn("routes/detail.tsx", names)
        self.assertIn("lib/triage.ts", names)
        self.assertIn("AGENTS.md", names)
        self.assertIn("GEMINI.md", names)
        self.assertNotIn("detail.tsx", names)


class ScopeBreaches(unittest.TestCase):
    def test_suffix_matches_nested_file(self):
        hits = scope_breaches(
            ["routes/detail.tsx"],
            ["web/src/routes/detail.tsx", "web/src/components/space-tree.tsx"],
        )
        self.assertEqual(hits, ["web/src/routes/detail.tsx"])

    def test_sibling_test_file_is_not_the_named_file(self):
        hits = scope_breaches(
            ["routes/detail.tsx"],
            ["web/src/routes/detail.test.tsx"],
        )
        self.assertEqual(hits, [])

    def test_bare_filename_is_repo_wide(self):
        # A bare filename is repo-wide. Operators who mean one file must write
        # the path (`bridge/config.ts`).
        hits = scope_breaches(
            ["config.ts"],
            ["bridge/config.ts", "web/src/lib/config.ts"],
        )
        self.assertEqual(hits, ["bridge/config.ts", "web/src/lib/config.ts"])

    def test_directory_prefix(self):
        hits = scope_breaches(
            ["bridge/"],
            ["bridge/server.ts", "web/src/lib/foo.ts"],
        )
        self.assertEqual(hits, ["bridge/server.ts"])

    def test_clean_diff(self):
        hits = scope_breaches(["bridge/"], ["web/src/components/space-tree.tsx"])
        self.assertEqual(hits, [])

    def test_exact_path(self):
        hits = scope_breaches(
            ["web/src/routes/detail.tsx"],
            ["web/src/routes/detail.tsx"],
        )
        self.assertEqual(hits, ["web/src/routes/detail.tsx"])


if __name__ == "__main__":
    unittest.main()
