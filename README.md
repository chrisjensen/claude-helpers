# claude-helpers

Home for the personal Claude Code / Kimi / opencode **harness-layer** helpers that
don't belong in any single tool's repo: the shared harness abstraction, the
PreToolUse enforcer hooks, and the claude/opencode launchers.

The PreToolUse hooks are **not** registered directly with the harness. Instead they
are registered as ordered `chainedHooks` in [claude-perms'](../claude-perms)
`~/.claudeperms/config.json`, and claude-perms — the single PreToolUse hook the
harness sees — runs and digests them into one deterministic verdict. `install.mjs`
wires that up.

## Layout

- `hooks/lib/harness.mjs` — `detectHarness`, `harnessAgentName`,
  `harnessInstructionsFile`, plus `readStdin`/`parseInput`/`block`. The Node twin of
  `detectHarness` in claude-perms' `permissions.mjs`.
- `hooks/lib/harness.sh` — the bash twin, for any remaining shell hooks.
- `hooks/source-commit-enforce.mjs` — blocks direct `git commit` (enforces the
  /source-commit skill). Exceptions: `--amend`, and commits mid merge/rebase/
  cherry-pick/revert.
- `hooks/long-command-suggest.mjs` — blocks foreground long-running commands
  (build/test/docker/…) without a log redirect; tells the agent to background +
  redirect to `/tmp/claude/<name>.log`.
- `hooks/plan-review-suggest.mjs` — on `ExitPlanMode`, asks the agent to run
  /plan-review first (once per session).
- `hooks/quality-all-suggest.mjs` — **Stop** event hook: blocks stop when this
  session left uncommitted changes and /quality-all hasn't run, suggesting it.
- `hooks/quality-baseline-init.mjs` — **SessionStart** event hook: snapshots the
  dirty-file list so quality-all-suggest only nags about *this* session's changes.
- `hooks/git-push-remind.mjs` — **PostToolUse** (Bash) event hook: after
  `git push`, nudges the agent to run /gh-pr-watch (non-blocking).
  These three are **event hooks** registered directly in `~/.claude/settings.json`
  (not claude-perms chainedHooks). The two quality hooks also skip **research
  mode** (`CLAUDE_PERMS_MODE=research`).
- `bin/` — deployed to `~/.local/bin`:
  - opencode launchers: `hopencode` core; `kopencode`/`qopencode`/`gopencode` exec it.
  - claude launchers: `zclaude`/`kclaude`/`qclaude` (model-routed) and `headclaude`.
    All launchers print their own name to stderr on exit (a reminder of which command
    started the session), suppressed in script/non-interactive use so they never
    pollute output a caller consumes.
  - `hive-signal.sh` — the hive run signal primitive (see below).
- `skills/hive-worker`, `skills/hive-coordinate` — the two skills that run inside a
  **hive** run (see below). Kept at the repo root, **not** under `.claude/`, so they
  install globally without also being active in this repo's own sessions.
- `install.mjs` — deploys `hooks/` → `~/.claude/hooks/`, `bin/` → `~/.local/bin`,
  `skills/` → `~/.claude/skills/`,
  registers the enforcers (+ rtk) as ordered `chainedHooks`, and registers the three
  event hooks (Stop / SessionStart / PostToolUse) in `~/.claude/settings.json`. Node
  (not shell) so the config merge is a plain `JSON.parse`/`stringify` — no jq —
  matching the hooks' runtime.
- `test/hooks.test.mjs` — unit tests for the Node hooks.
- `test/harness.test.sh` — unit checks for the bash harness lib.
- `test/launchers.test.sh` — exit-note checks for the bin/ launchers (stubbed
  downstream commands, pty + pipe paths).

## hive — parallel multi-model runs

Run the same task in **N** Claude Code sessions (each a different model/launcher —
`claude`, `zclaude`/GLM, `kclaude`, …) plus one coordinator session: all N plan → the
coordinator merges the plans into one hybrid → all N implement it and run
`/quality-all` → the coordinator reviews the N implementations, **promotes the best**
(folding in worthwhile bits from the others, with the user's approval) as a PR.

**Why separate sessions, not subagents or one conversation.** Anthropic signs assistant
turns and rejects a conversation whose history it didn't sign, so a non-Anthropic turn
locks that conversation out of Anthropic — **never mix providers in one conversation.**
Each hive session is therefore a separate, single-provider conversation, and they
**coordinate only through files + git**. The coordinator reads worker `PLAN.md` / diffs
as plain file content (no signature, taints nothing) and never resumes a worker session.
Subagents can't help — they share the parent's provider+auth (parallelism, no model
diversity).

**Division of labour.** The **spawn layer** (`clorchestrate --benchmark`) creates the run
dir, N worktrees, and launches the sessions. This repo provides only what runs *inside*
the sessions: `bin/hive-signal.sh` and the two skills.

**Layout convention** (no manifest, no JSON — pure filesystem):

```
<run-dir>/                 # the coordinator's CWD
  task.md                  # the task (spawn layer)
  PLAN.hybrid.md           # the reviewed plan (coordinator)
  <label>.plan.done        # signal sentinels (bare files: existence = done)
  plan.merged
  <label>.impl.done
  <label>/                 # one git worktree per worker, dir named for its label
  <label>/                 # e.g. claude/, zclaude/, kclaude/
```

The **label set is the run dir's subdirectories** (each a worktree named for its label;
sentinels are files, so they never clash with worktree dirs). A worker's label is
`basename "$PWD"`; its branch is
`git -C <label> rev-parse --abbrev-ref HEAD`. The only value the spawn layer must supply
that isn't on disk is the PR **base** branch — passed as the `/hive-coordinate <base>`
argument. Everything is N-agnostic; nothing is hardcoded.

**Signals** are bare sentinel files in `<run-dir>` itself — existence means "done" (no
payload, so nothing to malform or collide on; files never clash with worktree subdirs).
Everything sits in the run dir, so it dies with the run — no extra cleanup.

- `hive-signal.sh emit <coord_dir> <label> <stage>` — worker signals `plan` / `impl`
  done.
- `hive-signal.sh merged <coord_dir>` — coordinator releases the workers to implement.
- `hive-signal.sh wait <coord_dir> <stage>` — block until **every** label's `<stage>`
  signal exists (labels = the run dir's subdirs).
- `hive-signal.sh wait-one <coord_dir> <signal>` — block on one sentinel (e.g.
  `plan.merged`).

Waits block via `inotifywait` (**prereq: `apt install inotify-tools`**) and fall back to
polling if it's absent. There are no failure/timeout signals — the sessions are
interactive, so a worker error is recovered by the human in that tab.

Invoke `/hive-worker` (no args — it derives the run dir and its label from `$PWD`) in
each worker session and `/hive-coordinate <base>` in the coordinator session.

## Hook contract

Each **PreToolUse enforcer** reads the tool-call JSON on stdin and follows the
harness's PreToolUse contract, which claude-perms digests:

- **exit 0** → allow.
- **exit 2 + stderr** → block; stderr is the reason fed back to the agent.

The **event hooks** (Stop / SessionStart / PostToolUse) instead emit their verdict
as stdout JSON and exit 0 — a `{decision:"block",reason}` for Stop, a
`hookSpecificOutput.additionalContext` for PostToolUse.

`tool_input.command` is identical across Claude Code / Kimi / opencode; only the
tool name differs (handled by the `matcher`, not the hook).

**Kill switch:** setting `X_CLAUDE_HELPERS_SUPPRESS_NAGS=1` makes every nag/block
hook (commit, quality, long-command, plan-review, push) exit early — a global
opt-out for a session where you don't want to be nagged.

## Develop

```sh
npm test               # all suites: Node hooks + bash harness + launchers
npm run setup          # deploy to ~/.claude + ~/.local/bin, register chainedHooks
```

`install.mjs` requires claude-perms to be set up first (it merges `chainedHooks` into
`~/.claudeperms/config.json`); it errors clearly if that file is missing. It replaces
only the `chainedHooks` key — `trash` and other config are preserved.
