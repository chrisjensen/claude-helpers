#!/usr/bin/env node
// @ts-check
// Enforce /source-commit. PreToolUse hook (Claude Code: Bash matcher; Kimi:
// Shell matcher). tool_input.command is identical across harnesses; exit 2 +
// stderr blocks and feeds the reason to the agent in both.
//
// Registered as a claude-perms chainedHooks entry, so claude-perms runs it and
// digests the exit-2/stderr verdict into its single decision.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readStdin, parseInput, detectHarness, harnessInstructionsFile, block } from './lib/harness.mjs';

const input = parseInput(readStdin());
const harness = detectHarness(input);
const instructions = harnessInstructionsFile(harness);

const cmd = input?.tool_input?.command ?? '';
if (!cmd) process.exit(0);

// Match `git commit` (allowing intermediate `-c key=val`, `-C path`,
// `--git-dir=...` flags). Conservative: a `git` token, then any number of
// flag/value tokens, then `commit`.
const COMMIT_RE =
  /(^|[^A-Za-z0-9_/])git(\s+(-[A-Za-z]|--[A-Za-z][A-Za-z0-9_-]*)(\s+\S+|=\S+)?)*\s+commit(\s|$)/;
if (!COMMIT_RE.test(cmd)) process.exit(0);

// Reject any commit (even otherwise-allowed ones) that carries the bypass tell.
if (/co[-_]?authored[-_]?by/i.test(cmd)) {
  block(
    "Blocked: commit message contains a Co-Authored-By trailer. That trailer is the hallmark of bypassing /source-commit (the skill explicitly says 'Avoid co-authors'). Run /source-commit to write commit.sh, then `sh commit.sh`."
  );
}

// Allow --amend (user wants help with rebases / fix-typo amends).
if (/(^|\s)--amend(\s|=|$)/.test(cmd)) process.exit(0);

// Allow commits during merge / rebase / cherry-pick / revert state.
let gitDir;
try {
  gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim();
} catch {
  process.exit(0); // not in a repo — let git itself fail
}
if (
  existsSync(join(gitDir, 'MERGE_HEAD')) ||
  existsSync(join(gitDir, 'rebase-merge')) ||
  existsSync(join(gitDir, 'rebase-apply')) ||
  existsSync(join(gitDir, 'CHERRY_PICK_HEAD')) ||
  existsSync(join(gitDir, 'REVERT_HEAD'))
) {
  process.exit(0);
}

block(
  "Blocked: don't run `git commit` directly. Use the /source-commit skill to write commit.sh, then run `sh commit.sh`. " +
    `(${instructions}: 'Always commit via the /source-commit skill — do not run git commit directly. This applies to every repo and every commit, including amendments.') ` +
    'Exceptions already permitted by this hook: --amend, and commits during an active merge/rebase/cherry-pick/revert.'
);
