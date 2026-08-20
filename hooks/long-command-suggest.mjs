#!/usr/bin/env node
// @ts-check
// PreToolUse hook (Claude Code: Bash matcher; Kimi: Shell matcher).
//
// When a long-running command is invoked in the foreground without a log-file
// redirect, block the call and tell the agent to retry with a background run and
// stdout/stderr redirected to /tmp/claude/<name>.log.
//
// Bypasses (any of these passes through):
//   - run_in_background: true
//   - command already contains a `> something.log 2>&1` redirect
//   - command does not match the long-running pattern list
//   - `docker run -d ...` (already detached)
//
// Registered as a claude-perms chainedHooks entry.

import { readStdin, parseInput, detectHarness, harnessAgentName, block, nagsSuppressed } from './lib/harness.mjs';

if (nagsSuppressed()) process.exit(0);

const input = parseInput(readStdin());
const harness = detectHarness(input);
const agent = harnessAgentName(harness);

const command = input?.tool_input?.command ?? '';
const bg = input?.tool_input?.run_in_background === true;

// Already backgrounded -> allow.
if (bg) process.exit(0);

// Already redirects stdout to a log file with 2>&1 -> allow.
if (/> *[^ &|;]+\.log( |$|.*2>&1)/.test(command)) process.exit(0);

// Long-running command patterns (universal).
const LONG_RUNNING_RE =
  /(^|[\s&;|()`$])(npm\s+(test|run\s+(build|test|typecheck|lint|check|coverage))|pnpm\s+(test|run\s+(build|typecheck|lint|test))|yarn\s+(test|build|typecheck|lint)|tsc(\s|$)|pytest|jest|vitest|playwright\s+test|docker\s+(build|run)|docker\s+compose\s+build|cargo\s+(build|test)|mvn(\s|$)|gradle\s+)/;
if (!LONG_RUNNING_RE.test(command)) process.exit(0);

// `docker run -d ...` is already detached — let it pass.
if (/docker\s+run.*\s-d(\s|$)/.test(command)) process.exit(0);

block(
  `This command is in the long-running set (build/test/docker/etc.). Running it
foreground without a log redirect blocks the turn and pushes the full streamed
output into ${agent}'s context.

Retry with:
  command:           <your command> > /tmp/claude/<name>.log 2>&1
  run_in_background: true

Then \`tail\` or \`Read\` the log file when it finishes (you'll be notified).

Bypasses if you genuinely need to react mid-stream:
  - set run_in_background: true and stream the log file, OR
  - inline-redirect to a .log file (this hook will then allow the call).`
);
