# claude-helpers

Home for the personal Claude Code / Kimi / opencode **harness-layer** helpers that
don't belong in any single tool's repo: the shared harness abstraction, the
PreToolUse enforcer hooks, and the opencode launchers.

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
- `bin/` — opencode launchers (`hopencode` core; `kopencode`/`qopencode`/`gopencode`
  exec it). Deployed to `~/.local/bin`.
- `install.mjs` — deploys `hooks/` → `~/.claude/hooks/`, `bin/` → `~/.local/bin`,
  registers the enforcers (+ rtk) as ordered `chainedHooks`, and registers the three
  event hooks (Stop / SessionStart / PostToolUse) in `~/.claude/settings.json`. Node
  (not shell) so the config merge is a plain `JSON.parse`/`stringify` — no jq —
  matching the hooks' runtime.
- `test/hooks.test.mjs` — unit tests for the Node hooks.
- `test/harness.test.sh` — unit checks for the bash harness lib.

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
npm test               # Node hook tests
bash test/harness.test.sh   # bash harness lib test
npm run setup          # deploy to ~/.claude + ~/.local/bin, register chainedHooks
```

`install.mjs` requires claude-perms to be set up first (it merges `chainedHooks` into
`~/.claudeperms/config.json`); it errors clearly if that file is missing. It replaces
only the `chainedHooks` key — `trash` and other config are preserved.
