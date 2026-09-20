#!/usr/bin/env node
// @ts-check
// Install claude-helpers: deploy the hooks/ tree into ~/.claude/, the bin/
// launchers into ~/.local/bin, and register the PreToolUse enforcers (+ rtk) as
// ordered chainedHooks in claude-perms' config so claude-perms is the single hook
// that runs and digests them, and register the event hooks (quality-all Stop,
// quality-baseline SessionStart, git-push-remind PostToolUse) in
// ~/.claude/settings.json. Idempotent: overwrites deployed copies, rewrites the
// chainedHooks list from this repo's canonical order, and re-asserts the event
// hook entries without duplicating them.
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
  if (typeof name === 'string' && (name.endsWith('.mjs') || name.endsWith('.sh'))) {
    chmodSync(join(hooksDest, name), 0o755);
  }
}
// Hooks run via node-run.sh, which resolves a >=20 node at execution time —
// the session PATH may hold an older node (e.g. a project .nvmrc pinning an
// old LTS via nvm-auto), and .mjs hooks need node >=12 to parse.
const nodeRun = join(hooksDest, 'node-run.sh');
console.log(`installed: ${hooksDest}/ (harness lib + PreToolUse enforcers)`);

// --- resources/zclaude-charter.md -> ~/.claude (read by bin/zclaude) ----------
// Repo is canonical: overwrite so edits must be made here, not in the live copy.
const charterDest = join(DEST, 'zclaude-charter.md');
copyFileSync(join(SRC, 'resources', 'zclaude-charter.md'), charterDest);
console.log(`installed: ${charterDest}`);

// --- bin -> ~/.local/bin (must be on PATH) ------------------------------------
// opencode launchers (hopencode is the shared core; kopencode/qopencode/gopencode
// exec it, so all four must live together) plus hive-signal.sh (the hive run
// primitive the hive-worker/hive-coordinate skills call). Every bin/ file is
// deployed executable.
const binDest = join(HOME, '.local', 'bin');
mkdirSync(binDest, { recursive: true });
for (const entry of readdirSync(join(SRC, 'bin'), { withFileTypes: true })) {
  // Copy only launcher files; skip any dir the harness leaves here (e.g. an
  // empty .claude/.cc-writes created when editing with cwd under bin/).
  if (!entry.isFile()) continue;
  const target = join(binDest, entry.name);
  copyFileSync(join(SRC, 'bin', entry.name), target);
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
  { matcher: 'Bash', command: `${nodeRun} ${hooksDest}/long-command-suggest.mjs` },
  { matcher: 'Bash', command: `${nodeRun} ${hooksDest}/source-commit-enforce.mjs` },
  { matcher: 'ExitPlanMode', command: `${nodeRun} ${hooksDest}/plan-review-suggest.mjs` },
];
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log(`registered: chainedHooks in ${cfgPath} (rtk, long-command, source-commit, plan-review)`);

// --- skills -> ~/.claude/skills -----------------------------------------------
// hive-worker / hive-coordinate run inside hive sessions (usually in other repos),
// so they must live in the global skills dir. Merge our skill subdirs in without
// touching the user's other skills.
const skillsSrc = join(SRC, 'skills');
if (existsSync(skillsSrc)) {
  const skillsDest = join(DEST, 'skills');
  mkdirSync(skillsDest, { recursive: true });
  for (const name of readdirSync(skillsSrc)) {
    cpSync(join(skillsSrc, name), join(skillsDest, name), { recursive: true });
    console.log(`installed: ${join(skillsDest, name)}/`);
  }
}

// --- register event hooks in ~/.claude/settings.json --------------------------
// These three (quality-all Stop, quality-baseline SessionStart, git-push-remind
// PostToolUse) are event hooks, not PreToolUse chainedHooks, so they live in the
// harness's settings.json rather than claude-perms' config.
const settingsPath = join(DEST, 'settings.json');
if (!existsSync(settingsPath)) {
  console.error(`error: ${settingsPath} not found — set up Claude Code first, then re-run this.`);
  process.exit(1);
}

const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
settings.hooks ??= {};

// event -> managed entry. Idempotent: for each event we drop any existing entry
// referencing one of our basenames (old .sh or a prior .mjs), then append the
// current one — every other entry (chime, bd prime, caveman, terminal-title,
// permissions.mjs) is left untouched.
const managed = {
  Stop: { matcher: '', command: `${nodeRun} ${hooksDest}/quality-all-suggest.mjs` },
  SessionStart: { matcher: '', command: `${nodeRun} ${hooksDest}/quality-baseline-init.mjs` },
  PostToolUse: { matcher: 'Bash', command: `${nodeRun} ${hooksDest}/git-push-remind.mjs` },
};
const OURS = /quality-all-suggest|quality-baseline-init|git-push-remind/;

for (const [event, { matcher, command }] of Object.entries(managed)) {
  const kept = (settings.hooks[event] ?? []).filter(
    (entry) => !(entry?.hooks ?? []).some((h) => OURS.test(h?.command ?? ''))
  );
  kept.push({ matcher, hooks: [{ type: 'command', command }] });
  settings.hooks[event] = kept;
}

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log(`registered: event hooks in ${settingsPath} (quality-all, quality-baseline, git-push-remind)`);
