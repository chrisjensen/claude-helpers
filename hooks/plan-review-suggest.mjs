#!/usr/bin/env node
// @ts-check
// PreToolUse hook on ExitPlanMode: before presenting the plan, encourage running
// /plan-review with parallel subagents. Skip if /plan-review has already been
// invoked in this session.
//
// Registered as a claude-perms chainedHooks entry (matcher: ExitPlanMode).

import { existsSync, readFileSync } from 'node:fs';
import { readStdin, parseInput, block } from './lib/harness.mjs';

const input = parseInput(readStdin());
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

block(
  `Before presenting this plan, run /plan-review.

/plan-review fans out three parallel subagents to check the plan against:
  1. Existing repo architecture and conventions
  2. DRY (does the plan reuse what already exists?)
  3. Over-engineering (is anything bigger than the request needs?)

Address the findings, then call ExitPlanMode again. If you have already
run /plan-review and addressed the issues, say so explicitly and re-call
ExitPlanMode — this check will not block again in the same session.`
);
