#!/usr/bin/env bash
# Runs adw_simple_sdlc for a list of collie issue numbers in sequence: one branch + PR each.
# Usage: bash adws/drive_issues.sh 11 12
#   needs requests/issue-<n>-<slug>.md and a matching SLUG entry below.
# Each branch is cut from the last successful one (so overlapping edits stack, not conflict).
# A failed run is resumed once from its checkpoint; if it still fails, the work is WIP-committed
# on the branch and the driver moves on. PRs are opened against main.
# Run it detached (PowerShell Start-Process) — the Claude Code Bash tool kills jobs after 10 min.
set -u
export PYTHONUTF8=1
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO" || exit 1
LOG=$REPO/adws/adw_data/run_rest.log
SUMMARY=$REPO/adws/adw_data/run_rest_summary.txt
touch "$SUMMARY"
prev=main

declare -A SLUG=(
  [2]=trusted-user-fail-closed [3]=dns-rebinding-default [4]=bind-loopback-only
  [5]=env-parse-not-source [6]=verified-update [7]=subscribe-ssrf
  [8]=read-level-posts [9]=upload-mime [10]=error-page-leak
  [11]=frontend-static-hardening [12]=ops-hardening
)

for i in "$@"; do
  slug=${SLUG[$i]}
  br="fix/$i-$slug"
  req="requests/issue-$i-$slug.md"
  echo "=== #$i $br (base $prev) $(date)" | tee -a "$LOG"
  git checkout -q "$prev" || { echo "#$i: checkout $prev failed" >> "$SUMMARY"; continue; }
  git checkout -q -b "$br" || { echo "#$i: branch create failed" >> "$SUMMARY"; continue; }
  git add "$req" && git commit -q -m "Add ADW request for issue #$i" 2>>"$LOG"

  runlog="adws/adw_data/issue$i-run.log"
  uv run adws/adw_simple_sdlc.py "$req" > "$runlog" 2>&1
  rc=$?
  adw=$(grep -m1 -o 'adw_id: [0-9a-f]*' "$runlog" | awk '{print $2}')
  if [ $rc -ne 0 ] && [ -n "$adw" ]; then
    echo "--- #$i first run failed (adw $adw), resuming once" | tee -a "$LOG"
    uv run adws/adw_simple_sdlc.py "$req" --adw-id "$adw" > "adws/adw_data/issue$i-run2.log" 2>&1
    rc=$?
  fi
  if [ $rc -ne 0 ]; then
    echo "#$i: FAILED adw=$adw branch=$br (left in place, not pushed)" >> "$SUMMARY"
    git add -A -- . ':!adws/adw_data' 2>>"$LOG"; git commit -q -m "WIP: ADW $adw failed; uncommitted work kept for recovery" 2>>"$LOG"
    git checkout -q "$prev"
    continue
  fi
  git push -q -u origin "$br" 2>>"$LOG"
  title=$(gh issue view "$i" --json title -q .title)
  body="Closes #$i.

Branched from \`$prev\` — merge the earlier fix PRs first; this diff shrinks to its own change once they land.

Built by claudeSSSF run \`$adw\` (adw_simple_sdlc: opus plan, agy build, grok review, agy docs). See the commits for the spec, the change, and the write-up.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01D8fYu5TTS9f4ufUNPqQVN5"
  url=$(gh pr create --base main --head "$br" --title "$title (#$i)" --body "$body" 2>>"$LOG")
  echo "#$i: OK adw=$adw pr=$url" >> "$SUMMARY"
  prev=$br
done
echo "ALL DONE $(date)" | tee -a "$LOG"
cat "$SUMMARY"
