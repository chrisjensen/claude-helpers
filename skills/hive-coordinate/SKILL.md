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
   `/plan-review`, and write it to `PLAN.hybrid.md`.
3. **Get approval before releasing workers.** Summarize for the user: the key
   decisions made while merging, the final `PLAN.hybrid.md`, and anything else
   worth flagging (conflicting approaches, risks, things dropped from a
   worker's plan). Only once the user approves, release the workers:
   `hive-signal.sh merged .`.
4. **Wait for all implementations:** `hive-signal.sh wait . impl`.

Both waits already block until their sentinels exist — once backgrounded, don't poll
them with `sleep` or repeated checks (a standalone `sleep` is blocked by the harness
anyway); the session resumes when the backgrounded command completes. To check interim
progress, read the backgrounded task's own output instead.

5. **Review + promote.** For each worker, review `git -C <label> diff
   origin/<base>...HEAD` with `/feature-merge` + git-diff-reviewer. Pick the single best
   implementation, and identify any features from the other worktrees worth folding in.
   Present the merge plan to the user for approval **before** merging any worktree or
   opening a PR. On approval, open the PR from the winning branch with `/pr`.
6. **Record per-model performance.** Skip this step (and say so) if
   `~/.config/hive/sheets.json` doesn't exist — recording is best-effort, never blocks
   the run. Otherwise, for each label:
   - From `<label>/PLAN.md` and its diff (already read in steps 2 and 5), write a
     succinct comma-separated list of the features it covers, once for the plan and
     once for the implementation.
   - Take the union of features across all labels (plan and implementation
     separately); each label's `%` is its own feature count divided by that union's
     count, as a percentage.
   - Run `hive-signal.sh durations . <label>` for `planDurationSeconds` /
     `implDurationSeconds`.
   - Pipe one row into `hive-sheet-append.mjs`, `run` = this run dir's basename,
     `model` = `<label>`, `selected` = true only for the promoted implementation:
     ```
     echo '{"date":"...","run":"...","model":"...","planFeatures":"...",
       "planFeaturesPct":NN,"planDurationSeconds":NN,"implFeatures":"...",
       "implFeaturesPct":NN,"implDurationSeconds":NN,"selected":true}' \
       | hive-sheet-append.mjs
     ```

The worktrees and run dir are the spawn layer's to clean up.
