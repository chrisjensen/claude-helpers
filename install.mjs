#!/usr/bin/env node
// @ts-check
// Install claude-helpers: deploy the hooks/ tree into ~/.claude/, the bin/
// launchers into ~/.local/bin, and register the PreToolUse enforcers (+ rtk) as
// ordered chainedHooks in claude-perms' config so claude-perms is the single hook
// that runs and digests them. Idempotent: overwrites deployed copies and rewrites
// the chainedHooks list from this repo's canonical order.
//
// Node (not shell) so the config merge is a plain JSON.parse/stringify — no jq —
// and the runtime matches the hooks it deploys.

import { cpSync, mkdirSync, readdirSync, copyFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const DEST = join(HOME, '.claude');

// --- hooks tree -> ~/.claude/hooks (preserve lib/, make .mjs executable) ------
const hooksDest = join(DEST, 'hooks');
mkdirSync(hooksDest, { recursive: true });
cpSync(join(SRC, 'hooks'), hooksDest, { recursive: true });
for (const name of readdirSync(hooksDest, { recursive: true })) {
  if (typeof name === 'string' && name.endsWith('.mjs')) chmodSync(join(hooksDest, name), 0o755);
}
console.log(`installed: ${hooksDest}/ (harness lib + PreToolUse enforcers)`);

// --- launchers -> ~/.local/bin (must be on PATH) ------------------------------
// hopencode is the shared core; kopencode/qopencode/gopencode exec it, so all
// four must live together here.
const binDest = join(HOME, '.local', 'bin');
mkdirSync(binDest, { recursive: true });
for (const name of readdirSync(join(SRC, 'bin'))) {
  const target = join(binDest, name);
  copyFileSync(join(SRC, 'bin', name), target);
  chmodSync(target, 0o755);
  console.log(`installed: ${target}`);
}

// --- register chainedHooks in claude-perms config -----------------------------
// claude-perms digests these: rtk (a command rewriter) runs FIRST so the gates
// and claude-perms' own check see the rewritten command; order is significant.
const cfgPath = join(HOME, '.claudeperms', 'config.json');
if (!existsSync(cfgPath)) {
  console.error(`error: ${cfgPath} not found — run claude-perms' scripts/setup.sh first, then re-run this.`);
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
// Replace only the chainedHooks key; every other key (e.g. trash) is preserved.
cfg.chainedHooks = [
  { matcher: 'Bash', command: 'rtk hook claude' },
  { matcher: 'Bash', command: `node ${hooksDest}/long-command-suggest.mjs` },
  { matcher: 'Bash', command: `node ${hooksDest}/source-commit-enforce.mjs` },
  { matcher: 'ExitPlanMode', command: `node ${hooksDest}/plan-review-suggest.mjs` },
];
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log(`registered: chainedHooks in ${cfgPath} (rtk, long-command, source-commit, plan-review)`);
