#!/usr/bin/env bash
# Doc link gate. Every relative link or backticked repo path in the entry docs must point at a file
# or folder that exists — a doc naming a phantom file (a renamed component, a moved script) sends the
# next agent to the wrong place, and nothing else notices. Run by the pre-commit hook when a doc is
# staged; run by hand with: scripts/check-doc-links.sh [file…]
#
# Checked: markdown links `[..](./path)` and `[..](path)` (relative, not http/mailto/#anchor), and
# backticked paths that look like repo files (`bridge/foo.ts`, `web/src/…`, `scripts/…`, `.adr/…`).
# Anchors (`#…`) and everything after them are stripped before the existence test.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  files=(CLAUDE.md CONTEXT.md AGENTS.md README.md ARCHITECTURE.md DEPLOYMENT.md HARNESS_CONTRIBUTING.md HERDR_API.md NEXT-SESSION.md .adr/README.md)
fi

fail=0
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  dir="$(dirname "$f")"
  # 1) markdown links
  # 2) backticked repo paths — only prefixes we know are directories, so prose like `foo.ts` alone is ignored
  {
    grep -oE '\]\(([^)#[:space:]]+)' "$f" | sed 's/^](//' | grep -vE '^(https?:|mailto:|file:)' || true
    grep -oE '`(bridge|web/src|web/public|scripts|contrib|systemd|adws|specs|requests|app_docs|\.adr|\.github)/[^` ]*`' "$f" | tr -d '`' || true
  } | sed 's/#.*$//' | sort -u | while read -r p; do
    [ -n "$p" ] || continue
    case "$p" in *'<'*|*'{'*) continue ;; esac   # `<name>` placeholders and {a,b} lists are not single paths
    # backticked paths are repo-root relative; markdown links are relative to the doc
    case "$p" in
      ./*|../*) target="$dir/$p" ;;
      *) if [ -e "$dir/$p" ]; then target="$dir/$p"; else target="$p"; fi ;;
    esac
    # a trailing "…" or "*" means "and more" — test the parent
    target="${target%%\**}"; target="${target%%…*}"
    [ -e "$target" ] && continue
    # a prefix like `.adr/0002` names a file by its number — accept if anything starts with it
    if compgen -G "${target}*" >/dev/null 2>&1; then continue; fi
    echo "✗ $f → $p (not found)" >&2
    echo fail
  done | grep -q fail && fail=1
done

if [ "$fail" -ne 0 ]; then
  echo "  → fix the path, or drop the link. Doc-only commits can bypass with SKIP_VERSION_CHECK=1." >&2
  exit 1
fi
echo "✓ doc links resolve"
