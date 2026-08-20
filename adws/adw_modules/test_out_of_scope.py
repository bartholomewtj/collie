"""#69 — named Out of scope: files vs the diff. Drives quality_scope
(parse_out_of_scope, scope_breaches), the functions quality.out_of_scope calls.
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

    def test_issue_67_backtick_path(self):
        names = parse_out_of_scope(ISSUE_67)
        self.assertIn("routes/detail.tsx", names)

    def test_issue_82_dirs_not_prose(self):
        names = parse_out_of_scope(ISSUE_82)
        self.assertIn("bridge/", names)
        self.assertIn("adws/", names)
        joined = " ".join(names)
        self.assertNotIn("Herdr", joined)
        self.assertNotRegex(joined, r"#84")
        self.assertNotIn("filter-by-query", names)

    def test_bare_file_with_extension(self):
        names = parse_out_of_scope("Out of scope: quality.py, the rest of the app.")
        self.assertIn("quality.py", names)


class ScopeBreaches(unittest.TestCase):
    def test_suffix_matches_nested_file(self):
        # #67: named routes/detail.tsx, builder wrote web/src/routes/detail.tsx
        hits = scope_breaches(
            ["routes/detail.tsx"],
            ["web/src/routes/detail.tsx", "web/src/components/space-tree.tsx"],
        )
        self.assertEqual(hits, ["web/src/routes/detail.tsx"])

    def test_directory_prefix(self):
        hits = scope_breaches(["bridge/"], ["bridge/server.ts", "web/src/lib/foo.ts"])
        self.assertEqual(hits, ["bridge/server.ts"])

    def test_clean_diff(self):
        hits = scope_breaches(["bridge/"], ["web/src/components/space-tree.tsx"])
        self.assertEqual(hits, [])

    def test_sibling_test_file_is_not_the_named_file(self):
        hits = scope_breaches(
            ["routes/detail.tsx"],
            ["web/src/routes/detail.test.tsx"],
        )
        # suffix match is exact — detail.test.tsx is not detail.tsx
        self.assertEqual(hits, [])

    def test_exact_path(self):
        hits = scope_breaches(
            ["web/src/routes/detail.tsx"],
            ["web/src/routes/detail.tsx"],
        )
        self.assertEqual(hits, ["web/src/routes/detail.tsx"])


if __name__ == "__main__":
    unittest.main()
