#!/usr/bin/env node
// @ts-check
// PostToolUse hook (Bash matcher): after a `git push`, remind the agent to run
// /gh-pr-watch so CI is actually watched to green rather than fired-and-forgotten.
// Non-blocking: surfaces additionalContext only. tool_input.command is identical
// across Claude Code (Bash) and Kimi Code CLI (Shell).
//
// Output contract (PostToolUse): stdout JSON with hookSpecificOutput.additionalContext
// feeds context to the agent; exit 0 with no output is a no-op.
//
// Registered directly in ~/.claude/settings.json (PostToolUse, Bash matcher).

import { readStdin, parseInput, nagsSuppressed } from './lib/harness.mjs';

if (nagsSuppressed()) process.exit(0);

const input = parseInput(readStdin());

const cmd = input?.tool_input?.command ?? '';
if (!cmd) process.exit(0);

// Match a `git push` token (allowing intermediate `-c key=val`, `--git-dir=...`
// flag/value tokens). Conservative: a `git` token, any flags, then `push`.
const PUSH_RE =
  /(^|[^A-Za-z0-9_/])git(\s+(-[A-Za-z]|--[A-Za-z][A-Za-z0-9_-]*)(\s+\S+|=\S+)?)*\s+push(\s|$)/;
if (!PUSH_RE.test(cmd)) process.exit(0);

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        'Just pushed. If this branch has an open PR (or you just created one), run ' +
        "/gh-pr-watch to watch CI to green and fix any failures — don't consider the " +
        'work done until checks pass.',
    },
  })
);
