import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const bounded = join(process.cwd(), 'scripts/bounded.mjs');

function run(time: string, killAfter: string, script: string) {
  return spawnSync(process.execPath, [bounded, '--time', time, '--kill-after', killAfter, '--', 'sh', '-c', script],
    { encoding: 'utf8', timeout: 5000 });
}

test('a command past its time is stopped with its whole group and exits 124', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-bounded-'));
  let pgid = 0;
  t.after(() => {
    try { if (pgid) process.kill(-pgid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  const pgidFile = join(dir, 'pgid');
  const start = Date.now();
  const result = run('0.3', '0.3',
    `echo $$ > '${pgidFile}'; sh -c 'trap "" TERM; while :; do sleep 0.05; done' & wait`);
  const elapsed = Date.now() - start;
  pgid = Number(readFileSync(pgidFile, 'utf8').trim());
  assert.equal(result.error, undefined);
  assert.equal(result.status, 124, result.stderr);
  assert.ok(elapsed < 3000, `took ${elapsed} ms`);
  assert.ok(pgid > 0);
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      process.kill(-pgid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') break;
      throw error;
    }
    if (Date.now() > deadline) assert.fail(`process group ${pgid} survived`);
    await new Promise(r => setTimeout(r, 50));
  }
});

test("the command's exit code passes through", () => {
  const result = run('5', '1', 'exit 3');
  assert.equal(result.error, undefined);
  assert.equal(result.status, 3, result.stderr);
});

test('a command killed by a signal exits 128 + its number', () => {
  const result = run('5', '1', 'kill -TERM $$');
  assert.equal(result.error, undefined);
  assert.equal(result.status, 143, result.stderr);
});
