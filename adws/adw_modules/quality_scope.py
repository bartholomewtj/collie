"""Named Out-of-scope paths vs a diff file list (#69).

writes: is path-shaped. A request can still name a file under an allowed
directory as out of scope. This module is the mechanical check: parse those
names, then see if they appear in git's file list. No I/O, no pydantic — the
quality block in quality.py is the caller.
"""
from __future__ import annotations

import re
from pathlib import Path

_OUT_OF_SCOPE_SECTION = re.compile(
    r"(?is)(?:^|\n)\s*out of scope:\s*(.*?)(?:\n\s*\n|\Z)"
)
_BACKTICK_PATH = re.compile(r"`([^`]+)`")
# A path with at least one slash, optional trailing slash (`bridge/`, `web/src/foo.tsx`).
_SLASHY = re.compile(r"[A-Za-z][A-Za-z0-9_.-]*(?:/[A-Za-z0-9_.*-]*)+")
# A bare filename with a code extension.
_FILE = re.compile(
    r"[A-Za-z0-9_.-]+\.(?:tsx?|jsx?|py|md|json|toml|css|ya?ml|sh|ps1)"
)


def _norm(value: str) -> str:
    return value.strip().strip("`").replace("\\", "/").strip()


def parse_out_of_scope(request: str) -> list[str]:
    """File/dir names the request put out of scope. Empty if none named.

    Pulls backtick paths (`routes/detail.tsx`) and slashy/extension tokens
    (`bridge/`, `adws/`). Skips prose ("Herdr", "other issues") and issue refs
    (`#84/#86`).
    """
    if not request:
        return []
    match = _OUT_OF_SCOPE_SECTION.search(request)
    if not match:
        return []
    body = match.group(1)
    found: list[str] = []
    for tick in _BACKTICK_PATH.findall(body):
        if "/" in tick or Path(tick).suffix:
            found.append(_norm(tick))
    for token in re.split(r"[,;]", body):
        token = token.strip().strip(".")
        if not token or token.startswith("#"):
            continue
        if " " not in token and ("/" in token or _FILE.fullmatch(token)):
            found.append(_norm(token))
            continue
        for piece in _SLASHY.findall(token):
            if piece.startswith("#"):
                continue
            found.append(_norm(piece))
        for piece in _FILE.findall(token):
            found.append(_norm(piece))
    return [p for p in dict.fromkeys(found) if p]


def scope_breaches(forbidden: list[str], changed: list[str]) -> list[str]:
    """Changed paths that match a named out-of-scope file or directory."""
    hits: list[str] = []
    for raw in changed:
        path = raw.replace("\\", "/")
        if not path:
            continue
        for name in forbidden:
            if _scope_match(name, path):
                hits.append(path)
                break
    return hits


def _scope_match(name: str, path: str) -> bool:
    name = _norm(name)
    if not name:
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
