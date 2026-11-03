#!/usr/bin/env node
// @ts-check
// PreToolUse hook on ExitPlanMode, and on Write of a PLAN.md: before presenting or
// writing out the plan, encourage running /plan-review with parallel subagents.
// PLAN.md covers sessions that plan to a file instead of through plan mode (e.g. pool
// workers). Skip if /plan-review has already been invoked in this session.
//
// Registered as claude-perms chainedHooks entries (matchers: ExitPlanMode, Write).

import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readStdin, parseInput, block, nagsSuppressed } from './lib/harness.mjs';

if (nagsSuppressed()) process.exit(0);

const input = parseInput(readStdin());

const PLAN_FILE_NAME = 'PLAN.md';
const isPlanFileWrite =
  input?.tool_name === 'Write' && basename(input?.tool_input?.file_path ?? '') === PLAN_FILE_NAME;
if (input?.tool_name === 'Write' && !isPlanFileWrite) process.exit(0);
const transcriptPath = input?.transcript_path ?? '';

// If /plan-review has already run in this session, let the plan exit through.
if (transcriptPath && existsSync(transcriptPath)) {
  let transcript = '';
  try {
    transcript = readFileSync(transcriptPath, 'utf8');
  } catch {
    transcript = '';
  }
  if (transcript.includes('"name":"plan-review"') || transcript.includes('/plan-review')) {
    process.exit(0);
  }
}

const action = isPlanFileWrite ? `writing ${PLAN_FILE_NAME}` : 'presenting this plan';
const retry = isPlanFileWrite ? `write ${PLAN_FILE_NAME}` : 'call ExitPlanMode';

block(
  `Before ${action}, run /plan-review.

/plan-review fans out three parallel subagents to check the plan against:
  1. Existing repo architecture and conventions
  2. DRY (does the plan reuse what already exists?)
  3. Over-engineering (is anything bigger than the request needs?)

Address the findings, then ${retry} again. If you have already run
/plan-review and addressed the issues, say so explicitly and ${retry}
again — this check will not block again in the same session.`
);
