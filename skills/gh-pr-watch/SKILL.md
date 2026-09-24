---
name: gh-pr-watch
description: background process to wait for PR checks to pass; flags merge conflicts against the base branch
argument-hint: "[pr-number-or-url]"
arguments: [pr]
model: haiku
effort: low
context: fork
---

Execute the bash block below verbatim using the Bash tool. Do NOT substitute, simplify, shorten, or reformat the script. Do NOT replace it with a direct one-shot `gh pr checks` call, and do NOT build your own polling loop (sleep + re-check + grep) around it — `gh pr checks --watch` already blocks until CI finishes.

The script's exit code is the verdict. Never parse its stdout (or raw `gh pr checks` output) for "pass"/"fail" strings — the output format changes between pending and completed states, so string-matching waits on signals that aren't there:
- exit 0 — all checks passed
- exit 1 — a check failed (failure log path is on stderr)
- exit 2 — PR has merge conflicts with the base branch; stop watching and resolve conflicts first

CI can take 10+ minutes. Run the script with `run_in_background` if the Bash timeout is a concern, then read its output file on completion — do not restructure the script into a poller to dodge the timeout.

After it completes, report its stdout and exit code to the caller verbatim. Do not paraphrase, summarize, or decorate with bullet points or markdown.

```bash
tmp="$(mktemp -t gh-pr-checks.XXXXXX.log)"

pr_ref=""
if [ -n "${pr:-}" ]; then
  pr_ref="$pr"
fi

# Merge-conflict check first: watching checks is pointless if the PR can't merge.
# mergeable=CONFLICTING (or mergeStateStatus=DIRTY) means the branch needs a rebase/merge
# to resolve conflicts against the base before it can land.
merge_json="$(gh pr view ${pr_ref:+ "$pr_ref"} --json mergeable,mergeStateStatus 2>/dev/null)"
mergeable="$(printf '%s' "$merge_json" | grep -o '"mergeable":"[^"]*"' | cut -d'"' -f4)"
merge_state="$(printf '%s' "$merge_json" | grep -o '"mergeStateStatus":"[^"]*"' | cut -d'"' -f4)"
if [ "$mergeable" = "CONFLICTING" ] || [ "$merge_state" = "DIRTY" ]; then
  echo "Merge conflicts: PR has conflicts with the base branch and must be rebased/merged to resolve them before it can land."
  exit 2
fi

# If a PR ref is provided as the skill argument, watch that PR explicitly;
# otherwise default to the PR associated with the current branch (gh's default behavior).
if gh pr checks ${pr_ref:+ "$pr_ref"} --watch --fail-fast >"$tmp" 2>&1; then
  echo "Checks passed"
  exit 0
else
  echo "Checks failed"
  cat "$tmp" >&2
  echo "Full logs in $tmp" >&2
  exit 1
fi
```
