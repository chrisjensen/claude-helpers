// Unit tests for the PreToolUse hook ports. Each hook reads a tool-call JSON on
// stdin and follows the exit-0 (allow) / exit-2 + stderr (block) contract, so we
// spawn it and assert on the exit code and stderr.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
  return { code: r.status, stderr: r.stderr ?? '' };
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
