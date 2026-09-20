---
name: hive-coordinate
description: Run an A/B test of worker implementations — merge their plans, then review the implementations and promote the best as a PR. Invoked as `/hive-coordinate <base>`.
---

The run dir is your CWD; `hive-signal.sh` is on `PATH`. The **workers are the
subdirectories of the run dir** — each is a worktree named for its label (signal
sentinels are files, not dirs). Derive a worker's branch with
`git -C <label> rev-parse --abbrev-ref HEAD`. `<base>` (the PR target branch) is the
skill argument. No manifest — drive everything off the subdir list. N-agnostic.

1. **Wait for all plans** (backgrounded via `run_in_background`):
   `hive-signal.sh wait . plan`.
2. **Merge.** Read each `<label>/PLAN.md`, synthesize the strongest hybrid with
   `/plan-review`, write it to `PLAN.hybrid.md`, then release the workers:
   `hive-signal.sh merged .`.
3. **Wait for all implementations:** `hive-signal.sh wait . impl`.
4. **Review + promote.** For each worker, review `git -C <label> diff
   origin/<base>...HEAD` with `/feature-merge` + git-diff-reviewer. Pick the single best
   implementation, and identify any features from the other worktrees worth folding in.
   Present the merge plan to the user for approval **before** merging any worktree or
   opening a PR. On approval, open the PR from the winning branch with `/pr`.

The worktrees and run dir are the spawn layer's to clean up.
