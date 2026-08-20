#!/usr/bin/env node
// @ts-check
// Stop hook: when uncommitted changes exist and /quality-all hasn't been run in
// this session, block the stop and suggest running it. Only nags when THIS
// session changed the set of dirty files, compared against the session-start
// snapshot written by quality-baseline-init.mjs (keyed by session_id).
//
// Output contract (Stop hook): stdout JSON { decision: "block", reason } blocks
// the stop and feeds the reason to the agent; exit 0 with no output allows it.
//
// Registered directly in ~/.claude/settings.json (Stop), not as a claude-perms
// chainedHook. Exits early under the global nag kill switch and in research mode.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStdin, parseInput, nagsSuppressed } from './lib/harness.mjs';

if (nagsSuppressed()) process.exit(0);
if (process.env.CLAUDE_PERMS_MODE === 'research') process.exit(0);

const input = parseInput(readStdin());

// Avoid recursion if the agent tries to stop again right after a block.
if (input?.stop_hook_active === true) process.exit(0);

// Only matters inside a git work tree.
try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
} catch {
  process.exit(0);
}

// Allow stop if the working tree is clean.
let current = '';
try {
  current = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
} catch {
  process.exit(0);
}
if (current.trim() === '') process.exit(0);

// Only nag when this session changed the dirty-file set versus the session-start
// snapshot. Comparison is trailing-newline-insensitive (matches the old bash).
const sessionId = input?.session_id ?? '';
if (sessionId) {
  const baselineFile = join(tmpdir(), `claude-quality-baseline-${sessionId}`);
  if (existsSync(baselineFile)) {
    const baseline = readFileSync(baselineFile, 'utf8');
    if (current.trimEnd() === baseline.trimEnd()) process.exit(0);
  } else {
    // No baseline (session predates this hook, or $TMPDIR was cleared): can't
    // attribute changes to this session. Record now and allow — err toward silence.
    try {
      writeFileSync(baselineFile, current);
    } catch {
      // Non-fatal.
    }
    process.exit(0);
  }
}

// If /quality-all has already been invoked in this session, allow stop.
const transcriptPath = input?.transcript_path ?? '';
if (transcriptPath && existsSync(transcriptPath)) {
  let transcript = '';
  try {
    transcript = readFileSync(transcriptPath, 'utf8');
  } catch {
    transcript = '';
  }
  if (transcript.includes('"name":"quality-all"') || transcript.includes('/quality-all')) {
    process.exit(0);
  }
}

// Block stop and suggest /quality-all.
const reason =
  'Uncommitted changes detected and /quality-all has not been run in this session. ' +
  'Run /quality-all (parallel subagents: correctness, consistency, dry, review). ' +
  'Address blocking issues, then commit via /source-commit. If the changes are ' +
  'intentionally not ready to review, say so explicitly and stop.';

console.log(JSON.stringify({ decision: 'block', reason }));
