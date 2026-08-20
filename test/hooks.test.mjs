// Unit tests for the hook ports. PreToolUse enforcers follow the exit-0 (allow)
// / exit-2 + stderr (block) contract; the event hooks (Stop / SessionStart /
// PostToolUse) emit their verdict as stdout JSON and exit 0. We spawn each hook
// and assert on exit code, stderr, and stdout.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'hooks');

function run(script, { input = {}, env = {}, cwd } = {}) {
  const r = spawnSync(process.execPath, [join(HOOKS, script)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, ...env },
    cwd,
    encoding: 'utf8',
  });
  return { code: r.status, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
}

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ch-hooks-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

describe('source-commit-enforce.mjs', () => {
  test('blocks a bare `git commit` in a clean repo', () => {
    const dir = tempRepo();
    try {
      const r = run('source-commit-enforce.mjs', {
        input: { tool_input: { command: 'git commit -m "wip"' } },
        cwd: dir,
      });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /source-commit/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('blocks a commit carrying a Co-Authored-By trailer', () => {
    const r = run('source-commit-enforce.mjs', {
      input: { tool_input: { command: 'git commit -m "x\n\nCo-Authored-By: A B <a@b>"' } },
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Co-Authored-By/);
  });

  test('allows --amend', () => {
    const r = run('source-commit-enforce.mjs', {
      input: { tool_input: { command: 'git commit --amend --no-edit' } },
    });
    assert.equal(r.code, 0);
  });

  test('allows a non-commit git command', () => {
    const r = run('source-commit-enforce.mjs', {
      input: { tool_input: { command: 'git status' } },
    });
    assert.equal(r.code, 0);
  });

  test('X_CLAUDE_HELPERS_SUPPRESS_NAGS=1 lets a bare commit through', () => {
    const dir = tempRepo();
    try {
      const r = run('source-commit-enforce.mjs', {
        input: { tool_input: { command: 'git commit -m "wip"' } },
        env: { X_CLAUDE_HELPERS_SUPPRESS_NAGS: '1' },
        cwd: dir,
      });
      assert.equal(r.code, 0);
      assert.equal(r.stderr, '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('long-command-suggest.mjs', () => {
  test('blocks a foreground long-running command', () => {
    const r = run('long-command-suggest.mjs', {
      input: { tool_input: { command: 'npm test' } },
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /run_in_background/);
  });

  test('allows when redirected to a .log with 2>&1', () => {
    const r = run('long-command-suggest.mjs', {
      input: { tool_input: { command: 'npm test > /tmp/claude/t.log 2>&1' } },
    });
    assert.equal(r.code, 0);
  });

  test('allows a non-long-running command', () => {
    const r = run('long-command-suggest.mjs', {
      input: { tool_input: { command: 'ls -la' } },
    });
    assert.equal(r.code, 0);
  });
});

describe('plan-review-suggest.mjs', () => {
  test('blocks ExitPlanMode when /plan-review has not run', () => {
    const r = run('plan-review-suggest.mjs', {
      input: { tool_name: 'ExitPlanMode', tool_input: {} },
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /plan-review/);
  });
});

describe('quality-baseline-init.mjs', () => {
  test('writes a baseline snapshot for the session', () => {
    const dir = tempRepo();
    const sessionId = `test-${process.pid}-${Date.now()}`;
    const baselineFile = join(tmpdir(), `claude-quality-baseline-${sessionId}`);
    try {
      run('quality-baseline-init.mjs', { input: { session_id: sessionId }, cwd: dir });
      assert.equal(existsSync(baselineFile), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(baselineFile, { force: true });
    }
  });
});

describe('quality-all-suggest.mjs', () => {
  test('blocks stop when a dirty repo has no /quality-all run', () => {
    const dir = tempRepo();
    writeFileSync(join(dir, 'dirty.txt'), 'x'); // untracked -> non-empty porcelain
    try {
      const r = run('quality-all-suggest.mjs', {
        input: { stop_hook_active: false }, // no session_id -> skip baseline gate
        cwd: dir,
      });
      assert.equal(r.code, 0);
      assert.match(r.stdout, /"decision":"block"/);
      assert.match(r.stdout, /quality-all/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('CLAUDE_PERMS_MODE=research suppresses the nag', () => {
    const dir = tempRepo();
    writeFileSync(join(dir, 'dirty.txt'), 'x');
    try {
      const r = run('quality-all-suggest.mjs', {
        input: { stop_hook_active: false },
        env: { CLAUDE_PERMS_MODE: 'research' },
        cwd: dir,
      });
      assert.equal(r.code, 0);
      assert.equal(r.stdout, '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('git-push-remind.mjs', () => {
  test('reminds after a git push', () => {
    const r = run('git-push-remind.mjs', {
      input: { tool_input: { command: 'git push origin main' } },
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /additionalContext/);
    assert.match(r.stdout, /gh-pr-watch/);
  });

  test('is a no-op for a non-push command', () => {
    const r = run('git-push-remind.mjs', {
      input: { tool_input: { command: 'git status' } },
    });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  });
});
