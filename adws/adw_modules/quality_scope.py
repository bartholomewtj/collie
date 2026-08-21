"""Named Out-of-scope paths vs a change-set (#69 / #104).

A name under `Out of scope:` is a **path**, not a sentence. Naming a file
means **zero edits** to that file — every edit, not "except this one line".
"Except this one line" is reviewer prose, not a gate. Put the allowed line in
a different file, or do not name the file.

Naming a directory (`bridge/`, `adws/`) forbids every path under it.

Prose (`Herdr`, `filter-by-query behaviour`, `other issues`) is ignored.
Issue refs (`#84/#86`) are ignored.

A bare filename (`config.ts`) is repo-wide: it matches every `*/config.ts`.
Operators who mean one file must write the path (`bridge/config.ts`).

Parse + match only. No I/O. The permissions denylist in `permissions.py` is
the caller — never a quality block, never `git diff HEAD`.
"""
from __future__ import annotations

import re

# Backtick paths that contain a slash or a recognised file suffix.
_BACKTICK = re.compile(r"`([^`]+)`")

# Start of the section: a line that is `Out of scope:` (colon form) or a
# markdown heading `## Out of scope`. Colon optional so both shapes match.
# `[ \t]` not `\s` — `\s` eats the blank line after a `## Out of scope` heading
# and then the first paragraph line is captured as "inline", dropping the rest.
_SECTION_START = re.compile(r"(?im)^(?:#{1,6}[ \t]+)?out of scope[ \t]*:?[ \t]*(.*)$")

_SUFFIXES = (
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".md", ".json", ".toml", ".yaml", ".yml",
    ".css", ".html", ".sh", ".ps1", ".svg", ".txt",
)


def _norm(value: str) -> str:
    return value.strip().strip("`").replace("\\", "/").strip()


def _looks_like_path(token: str) -> bool:
    """A path token: contains `/`, or ends with a recognised file suffix.

    Tokens that still have spaces are rejected by the caller before this
    runs — never `_FILE.findall` / `_SLASHY.findall` over a sentence.
    """
    if not token or token.startswith("#"):
        return False
    if "/" in token:
        return True
    lower = token.lower()
    return any(lower.endswith(suffix) for suffix in _SUFFIXES)


def _section_body(request: str) -> str | None:
    """The Out of scope section, or None when the request has no such heading.

    Stops at the next blank line or the end. A heading with no body on the
    same line (`## Out of scope`) skips following blank lines, then takes
    the next paragraph.
    """
    match = _SECTION_START.search(request)
    if not match:
        return None
    inline = match.group(1).strip()
    rest = request[match.end():]
    lines: list[str] = []
    started = bool(inline)
    if inline:
        lines.append(inline)
    for line in rest.splitlines():
        if not line.strip():
            if started:
                break
            continue
        started = True
        lines.append(line.strip())
    return "\n".join(lines) if lines else ""


def parse_out_of_scope(request: str) -> list[str]:
    """File/dir names the request put out of scope. Empty if none named.

    Only these tokens, from the Out of scope section:

    1. Backtick paths that contain a `/` or a recognised file suffix
       (`` `routes/detail.tsx` ``).
    2. Comma/semicolon tokens with **no spaces** that look like a path
       (`bridge/`, `quality.py`).

    Do not scan leftover prose for slashy or filename fragments — that is
    what emits `detail.tsx` from "beyond its one back-target line" and
    `badge/colour` from "blocked badge/colour visuals".
    """
    if not request:
        return []
    body = _section_body(request)
    if body is None:
        return []
    found: list[str] = []
    for tick in _BACKTICK.findall(body):
        token = _norm(tick)
        if _looks_like_path(token):
            found.append(token)
    for raw in re.split(r"[,;]", body):
        token = _norm(raw).rstrip(".,);:")
        if not token or " " in token:
            continue
        if _looks_like_path(token):
            found.append(token)
    return list(dict.fromkeys(found))


def denied_match(name: str, path: str) -> bool:
    """Whether `path` is forbidden by one out-of-scope name.

    1. Directory (`name` ends with `/`): `path == name[:-1]` or
       `path.startswith(name)`. Same idea as `permissions._matches`.
    2. Exact: `path == name`.
    3. Prefix: `path.startswith(name.rstrip("/") + "/")` so `bridge`
       matches `bridge/server.ts`.
    4. Suffix, files only: `path.endswith("/" + name)` so
       `routes/detail.tsx` matches `web/src/routes/detail.tsx`.
       Not for the `writes:` allowlist.
    """
    name = _norm(name)
    path = _norm(path)
    if not name or not path:
        return False
    if name.endswith("/"):
        return path == name[:-1] or path.startswith(name)
    if path == name:
        return True
    if path.startswith(name.rstrip("/") + "/"):
        return True
    if path.endswith("/" + name):
        return True
    return False


def scope_breaches(forbidden: list[str], changed: list[str]) -> list[str]:
    """Changed paths that match a named out-of-scope file or directory."""
    hits: list[str] = []
    for raw in changed:
        path = _norm(raw)
        if not path:
            continue
        if any(denied_match(name, path) for name in forbidden):
            hits.append(path)
    return hits
