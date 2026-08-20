// @ts-check
// Shared harness detection for PreToolUse hooks that run under Claude Code,
// Kimi Code CLI, and opencode. Mirrors permissions.mjs detectHarness (and the
// legacy harness.sh it replaces):
//   env CLAUDE_PERMS_HARNESS wins, else stdin JSON shape:
//     transcript_path -> claude, tool_call_id -> kimi. Default claude.
// opencode has no distinctive stdin shape here, so it is env-selected only
// (the opencode bridge plugin always sets CLAUDE_PERMS_HARNESS=opencode).

import { readFileSync } from 'node:fs';

/** @typedef {'claude' | 'kimi' | 'opencode'} Harness */

// Read all of stdin as a string. Hooks are fed the tool-call JSON there.
export function readStdin() {
  try {
    return readFileSync(0, 'utf8'); // fd 0 = stdin
  } catch {
    return '';
  }
}

/**
 * Parse the hook payload, tolerating empty/garbage input.
 * @param {string} raw
 * @returns {Record<string, any>}
 */
export function parseInput(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, any>} input
 * @returns {Harness}
 */
export function detectHarness(input) {
  switch (process.env.CLAUDE_PERMS_HARNESS) {
    case 'kimi':
    case 'kimicode':
      return 'kimi';
    case 'opencode':
      return 'opencode';
    case 'claude':
    case 'claude-code':
      return 'claude';
  }
  if (input && Object.prototype.hasOwnProperty.call(input, 'transcript_path')) return 'claude';
  if (input && Object.prototype.hasOwnProperty.call(input, 'tool_call_id')) return 'kimi';
  return 'claude';
}

/**
 * Agent display name for a harness.
 * @param {Harness} harness
 */
export function harnessAgentName(harness) {
  switch (harness) {
    case 'kimi':
      return 'Kimi';
    case 'opencode':
      return 'opencode';
    default:
      return 'Claude';
  }
}

/**
 * Project-instructions filename: Claude reads CLAUDE.md; Kimi + opencode read AGENTS.md.
 * @param {Harness} harness
 */
export function harnessInstructionsFile(harness) {
  switch (harness) {
    case 'kimi':
    case 'opencode':
      return 'AGENTS.md';
    default:
      return 'CLAUDE.md';
  }
}

/**
 * Global opt-out: when X_CLAUDE_HELPERS_SUPPRESS_NAGS=1 is set, every nag/block
 * hook (commit, quality, long-command, plan-review, push) exits early instead of
 * blocking or nagging. Checked as the first line of each such hook.
 * @returns {boolean}
 */
export function nagsSuppressed() {
  return process.env.X_CLAUDE_HELPERS_SUPPRESS_NAGS === '1';
}

/**
 * Block the tool call: write the reason to stderr and exit 2 (the PreToolUse
 * contract both Claude Code and Kimi honour — exit 2 blocks and feeds stderr to
 * the agent).
 * @param {string} reason
 * @returns {never}
 */
export function block(reason) {
  process.stderr.write(reason.endsWith('\n') ? reason : reason + '\n');
  process.exit(2);
}
