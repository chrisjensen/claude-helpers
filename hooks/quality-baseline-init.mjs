#!/usr/bin/env node
// @ts-check
// SessionStart hook: snapshot the changed-file list so the Stop hook
// (quality-all-suggest.mjs) only nags about /quality-all when THIS session
// changed the set of dirty files. Keyed by session_id; written once (no clobber).
//
// Registered directly in ~/.claude/settings.json (SessionStart), not as a
// claude-perms chainedHook. Exits early under the global nag kill switch and in
// research mode (no commits happen there, so no baseline is needed).

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStdin, parseInput, nagsSuppressed } from './lib/harness.mjs';

if (nagsSuppressed()) process.exit(0);
if (process.env.CLAUDE_PERMS_MODE === 'research') process.exit(0);

const input = parseInput(readStdin());

// Only meaningful inside a git work tree.
try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
} catch {
  process.exit(0);
}

const sessionId = input?.session_id ?? '';
if (!sessionId) process.exit(0);

const baselineFile = join(tmpdir(), `claude-quality-baseline-${sessionId}`);

// Don't clobber an existing baseline: compact/resume fire SessionStart again with
// the same session_id, and resetting would suppress nags for changes already made.
if (!existsSync(baselineFile)) {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
    writeFileSync(baselineFile, status);
  } catch {
    // Non-fatal: err toward silence rather than blocking session start.
  }
}
