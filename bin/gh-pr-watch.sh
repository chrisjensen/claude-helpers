#!/usr/bin/env bash
# gh-pr-watch.sh — block until a PR's CI checks finish, and report the verdict via exit code.
# Used by the gh-pr-watch skill; kept as a real script so the harness can't mangle it.
#
# Usage: gh-pr-watch.sh [pr-number-or-url]   (default: the PR for the current branch)
#
# Exit codes:
#   0  all checks passed
#   1  a check failed (failure log is printed to stderr, plus its path)
#   2  the PR has merge conflicts with its base branch; resolve them before watching CI

set -u

pr_ref="${1:-}"
tmp="$(mktemp -t gh-pr-checks.XXXXXX.log)"

# Merge-conflict check first: watching checks is pointless if the PR can't merge.
# mergeable=CONFLICTING (or mergeStateStatus=DIRTY) means the branch needs a rebase/merge
# to resolve conflicts with the base before it can land.
merge_json="$(gh pr view ${pr_ref:+"$pr_ref"} --json mergeable,mergeStateStatus 2>/dev/null)"
mergeable="$(printf '%s' "$merge_json" | grep -o '"mergeable":"[^"]*"' | cut -d'"' -f4)"
merge_state="$(printf '%s' "$merge_json" | grep -o '"mergeStateStatus":"[^"]*"' | cut -d'"' -f4)"

if [ "$mergeable" = "CONFLICTING" ] || [ "$merge_state" = "DIRTY" ]; then
  echo "Merge conflicts: PR has conflicts with its base branch and must be rebased/merged to resolve them before it can land."
  exit 2
fi

# --watch blocks until CI finishes; --fail-fast returns on the first failure.
if gh pr checks ${pr_ref:+"$pr_ref"} --watch --fail-fast >"$tmp" 2>&1; then
  echo "Checks passed"
  exit 0
else
  echo "Checks failed"
  cat "$tmp" >&2
  echo "Full logs in $tmp" >&2
  exit 1
fi
