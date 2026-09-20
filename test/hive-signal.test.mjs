// Unit test for bin/hive-signal.sh: with two worker subdirs, `wait <stage>` blocks
// until every label's sentinel exists, then exits 0. Also asserts `wait` fails loud
// on an empty run dir. (Uses the poll fallback when inotifywait is absent.)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'hive-signal.sh');

// Labels are the run dir's subdirs (each a worker worktree named for its label).
function coordWithWorkers(labels) {
  const dir = mkdtempSync(join(tmpdir(), 'hive-'));
  for (const label of labels) mkdirSync(join(dir, label));
  return dir;
}

const sh = (...args) => spawnSync(BIN, args, { encoding: 'utf8' });

describe('hive-signal.sh', () => {
  test('wait blocks until every label signals, then exits 0', async () => {
    const dir = coordWithWorkers(['claude', 'zclaude']);
    try {
      const waiter = spawn(BIN, ['wait', dir, 'plan'], { encoding: 'utf8' });
      const exited = new Promise((res) => waiter.on('exit', (code) => res(code)));

      sh('emit', dir, 'claude', 'plan');
      await delay(300);
      assert.equal(waiter.exitCode, null, 'wait should still block with one label outstanding');

      sh('emit', dir, 'zclaude', 'plan');
      const code = await exited;
      assert.equal(code, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('wait fails loud on an empty run dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hive-'));
    try {
      const r = sh('wait', dir, 'plan');
      assert.equal(r.status, 2);
      assert.match(r.stderr, /no worker subdirs/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
