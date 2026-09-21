---
name: hive-evaluate
description: Record per-model plan/implementation performance from a finished hive run to the configured Google Sheet. Invoked as `/hive-evaluate <base> <selected-label>`.
---

The run dir is your CWD; `hive-signal.sh` and `hive-sheet-append.mjs` are on `PATH`
(both deployed to `~/.local/bin` by this repo's `install.mjs`). The **workers are the
subdirectories of the run dir** — each is a worktree named for its label. `<base>` is
the PR target branch used to diff each worker; `<selected-label>` is the worker whose
implementation was promoted (`selected: true`, all others `false`).

Run this after `/hive-coordinate` has already merged plans, released workers, and
promoted the winning implementation — it needs each worker's `PLAN.md` and diff, which
only exist once those stages are done.

Skip this whole skill (and say so) if `~/.config/clorchestrate/sheets.json` doesn't
exist — recording is best-effort, never blocks the run.

For each label:

1. From `<label>/PLAN.md` and `git -C <label> diff origin/<base>...HEAD`, write a
   succinct comma-separated list of the features it covers, once for the plan and once
   for the implementation.
2. Take the union of features across all labels (plan and implementation separately);
   each label's `%` is its own feature count divided by that union's count, as a
   percentage.
3. Run `hive-signal.sh durations . <label>` for `planDurationSeconds` /
   `implDurationSeconds`.
4. Pipe one row into `hive-sheet-append.mjs`, `run` = this run dir's basename, `model`
   = `<label>`, `selected` = true only when `<label>` is `<selected-label>`:
   ```
   echo '{"date":"...","run":"...","model":"...","planFeatures":"...",
     "planFeaturesPct":NN,"planDurationSeconds":NN,"implFeatures":"...",
     "implFeaturesPct":NN,"implDurationSeconds":NN,"selected":true}' \
     | hive-sheet-append.mjs
   ```

The worktrees and run dir are the spawn layer's to clean up.
