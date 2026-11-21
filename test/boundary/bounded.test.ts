import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const bounded = join(process.cwd(), 'scripts/bounded.mjs');

function run(time: string, killAfter: string, script: string) {
  return spawnSync(process.execPath, [bounded, '--time', time, '--kill-after', killAfter, '--', 'sh', '-c', script],
    { encoding: 'utf8', timeout: 5000 });
}

function runWith(dir: string, flags: string[], script: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [bounded, ...flags, '--', 'sh', '-c', script],
    { encoding: 'utf8', timeout: 5000, env: { ...process.env, TMPDIR: dir, ...env } });
}

function scratch(t: TestContext, pids: number[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-bounded-'));
  t.after(() => {
    for (const pid of pids) try { process.kill(pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function gone(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    throw error;
  }
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

test('a descendant that leaves the group outlives the command and fails the run', async t => {
  const pids: number[] = [];
  const dir = scratch(t, pids);
  const child = 'const c = require("child_process").spawn("/bin/sleep", ["5"], { detached: true, stdio: "ignore" });'
    + ' c.unref(); console.log(c.pid); setTimeout(() => {}, 500)';
  const result = runWith(dir, ['--time', '5', '--kill-after', '1', '--memory', '1G', '--tasks', '64'],
    `node -e '${child}'`);
  const pid = Number(result.stdout.trim());
  if (pid > 0) pids.push(pid);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Surviving child: \d+/);
  assert.ok(pid > 0, result.stdout);
  const deadline = Date.now() + 2000;
  while (!gone(pid)) {
    if (Date.now() > deadline) assert.fail(`descendant ${pid} survived`);
    await new Promise(r => setTimeout(r, 50));
  }
});

test('a second run with a live lock is refused as already running', t => {
  const dir = scratch(t);
  mkdirSync(join(dir, 't.lock'));
  writeFileSync(join(dir, 't.lock', 'pid'), String(process.pid));
  const result = runWith(dir, ['--name', 't', '--time', '5', '--kill-after', '1'], 'exit 0');
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /t already running \(pid \d+\)/);
  assert.equal(readFileSync(join(dir, 't.lock', 'pid'), 'utf8'), String(process.pid));
});

test('an abandoned lock is removed and the run proceeds', t => {
  const dir = scratch(t);
  const dead = spawnSync('/usr/bin/true').pid;
  mkdirSync(join(dir, 't.lock'));
  writeFileSync(join(dir, 't.lock', 'pid'), String(dead));
  const result = runWith(dir, ['--name', 't', '--time', '5', '--kill-after', '1'], 'exit 0');
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(dir, 't.lock')), false);
});

test('a tree with more processes than --tasks is killed', t => {
  const dir = scratch(t);
  const start = Date.now();
  const result = runWith(dir, ['--time', '5', '--kill-after', '1', '--memory', '1G', '--tasks', '3'],
    'sleep 2 & sleep 2 & sleep 2 & sleep 2 & wait');
  const elapsed = Date.now() - start;
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /tasks limit exceeded/);
  assert.ok(elapsed < 2000, `took ${elapsed} ms`);
});

test('a tree above --memory summed RSS is killed', t => {
  const dir = scratch(t);
  const start = Date.now();
  const result = runWith(dir, ['--time', '5', '--kill-after', '1', '--memory', '32M', '--tasks', '64'],
    'node -e "const b = Buffer.alloc(96 * 1024 * 1024, 1); setTimeout(() => b.length, 2000)"');
  const elapsed = Date.now() - start;
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /memory limit exceeded/);
  assert.ok(elapsed < 2000, `took ${elapsed} ms`);
});

test('a clean named run prints Cost and removes its lock and run directory', t => {
  const dir = scratch(t);
  const result = runWith(dir, ['--name', 't', '--time', '5', '--kill-after', '1', '--memory', '1G', '--tasks', '64'],
    `printf %s "$MYPI_BOUNDED_DIR" > '${join(dir, 'rundir')}'`);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Cost: wall=\d+ms memory_peak=\d+ tasks_peak=\d+$/m);
  const rundir = readFileSync(join(dir, 'rundir'), 'utf8');
  assert.ok(rundir.length > 0);
  assert.equal(existsSync(rundir), false);
  assert.equal(existsSync(join(dir, 't.lock')), false);
});

test('runs racing for one abandoned lock leave exactly one running', async t => {
  const dir = scratch(t);
  mkdirSync(join(dir, 't.lock'));
  writeFileSync(join(dir, 't.lock', 'pid'), String(spawnSync('/usr/bin/true').pid));
  const runs = [0, 1, 2].map(() => new Promise<number | null>(resolve => {
    const child = spawn(process.execPath, [bounded, '--name', 't', '--time', '5', '--kill-after', '1', '--', 'sleep', '0.5'],
      { stdio: 'ignore', env: { ...process.env, TMPDIR: dir } });
    child.on('exit', code => resolve(code));
  }));
  const codes = await Promise.all(runs);
  assert.deepEqual(codes.filter(code => code === 0).length, 1, JSON.stringify(codes));
});

test('a run whose process table cannot be read fails at once', t => {
  const dir = scratch(t);
  const start = Date.now();
  const result = runWith(dir, ['--time', '5', '--kill-after', '1', '--memory', '1G', '--tasks', '64'], 'sleep 2',
    { MYPI_BOUNDED_PS: '/usr/bin/false' });
  const elapsed = Date.now() - start;
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /process table from \/usr\/bin\/false/);
  assert.match(result.stderr, /process table cannot be read/);
  assert.ok(elapsed < 2000, `took ${elapsed} ms`);
});

test('a live break of another run refuses and leaves the stale lock alone', t => {
  const dir = scratch(t);
  const dead = String(spawnSync('/usr/bin/true').pid);
  mkdirSync(join(dir, 't.lock'));
  writeFileSync(join(dir, 't.lock', 'pid'), dead);
  mkdirSync(join(dir, 't.lock.break'));
  writeFileSync(join(dir, 't.lock.break', 'pid'), String(process.pid));
  const result = runWith(dir, ['--name', 't', '--time', '5', '--kill-after', '1'], 'exit 0');
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /t already running/);
  assert.equal(readFileSync(join(dir, 't.lock', 'pid'), 'utf8'), dead);
  assert.equal(readFileSync(join(dir, 't.lock.break', 'pid'), 'utf8'), String(process.pid));
});

test('an abandoned break is removed and the run proceeds', t => {
  const dir = scratch(t);
  const dead = String(spawnSync('/usr/bin/true').pid);
  for (const lock of ['t.lock', 't.lock.break']) {
    mkdirSync(join(dir, lock));
    writeFileSync(join(dir, lock, 'pid'), dead);
  }
  const result = runWith(dir, ['--name', 't', '--time', '5', '--kill-after', '1'], 'exit 0');
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(dir, 't.lock')), false);
  assert.equal(existsSync(join(dir, 't.lock.break')), false);
});
