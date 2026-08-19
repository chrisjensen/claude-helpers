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
- `bin/` — opencode launchers (`hopencode` core; `kopencode`/`qopencode`/`gopencode`
  exec it). Deployed to `~/.local/bin`.
- `install.mjs` — deploys `hooks/` → `~/.claude/hooks/`, `bin/` → `~/.local/bin`, and
  registers the enforcers (+ rtk) as ordered `chainedHooks`. Node (not shell) so the
  config merge is a plain `JSON.parse`/`stringify` — no jq — matching the hooks' runtime.
- `test/hooks.test.mjs` — unit tests for the Node hooks.
- `test/harness.test.sh` — unit checks for the bash harness lib.

## Hook contract

Each hook reads the tool-call JSON on stdin and follows the harness's PreToolUse
contract, which claude-perms digests:

- **exit 0** → allow.
- **exit 2 + stderr** → block; stderr is the reason fed back to the agent.

`tool_input.command` is identical across Claude Code / Kimi / opencode; only the
tool name differs (handled by the `matcher`, not the hook).

## Develop

```sh
npm test               # Node hook tests
bash test/harness.test.sh   # bash harness lib test
npm run setup          # deploy to ~/.claude + ~/.local/bin, register chainedHooks
```

`install.mjs` requires claude-perms to be set up first (it merges `chainedHooks` into
`~/.claudeperms/config.json`); it errors clearly if that file is missing. It replaces
only the `chainedHooks` key — `trash` and other config are preserved.
