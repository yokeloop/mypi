import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, constants, mkdirSync, mkdtempSync, openSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireHomeLock } from '../../src/infrastructure/filesystem/home-lock.js';

test('home lock bounds contention and survives its holder through an actual Git descriptor', { timeout: 10000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-home-lock-')), home = join(dir, 'home');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(home, '.git'), { recursive: true });
  const alias = join(dir, 'alias');
  symlinkSync(home, alias);
  const first = acquireHomeLock(home), inode = statSync(join(home, '.git/mypi-home.lock')).ino;
  try {
    assert.throws(() => acquireHomeLock(alias), /bounded lock wait expired/);
  } finally { first.close(); }
  const second = acquireHomeLock(alias);
  second.close();
  assert.equal(statSync(join(home, '.git/mypi-home.lock')).ino, inode, 'release must not replace the lock inode');

  const module = fileURLToPath(new URL('../../src/infrastructure/filesystem/home-lock.js', import.meta.url));
  const program = `import {spawn} from 'node:child_process';
import {acquireHomeLock} from ${JSON.stringify(module)};
const lock = acquireHomeLock(process.argv[1]);
const git = spawn('/usr/bin/git', ['hash-object', '--stdin'], {
  stdio: [0, 1, 2, lock.descriptor],
  env: {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_TRACE2_EVENT: '2'},
});
git.once('spawn', () => process.send({pid: git.pid}));
git.once('error', () => process.exit(1));
process.on('message', () => {});`;
  // Keep stdin owned by the fixture: Node closes a ChildProcess.stdin pipe when
  // its immediate child dies, which would prematurely finish the surviving Git.
  const fifo = join(dir, 'git-input');
  const made = spawnSync('/usr/bin/mkfifo', ['--', fifo], { timeout: 1000, killSignal: 'SIGKILL' });
  assert.equal(made.status, 0, String(made.error ?? made.stderr));
  let input: number | undefined = openSync(fifo, constants.O_RDWR);
  const reader = openSync(fifo, constants.O_RDONLY);
  const holder = spawn(process.execPath, ['--input-type=module', '-e', program, home],
    { stdio: [reader, 'pipe', 'pipe', 'ipc'] });
  closeSync(reader);
  let gitPid: number | undefined, output = '', trace = '', gitFinished = false;
  holder.stdout!.setEncoding('utf8').on('data', chunk => { output += String(chunk); });
  const closed = once(holder, 'close');
  t.after(async () => {
    if (input !== undefined) { closeSync(input); input = undefined; }
    if (gitPid !== undefined && !gitFinished) {
      try { process.kill(gitPid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGKILL');
    await closed;
  });
  const ready = new Promise<void>((resolve, reject) => {
    holder.stderr!.setEncoding('utf8').on('data', chunk => {
      trace += String(chunk);
      if (trace.split('\n').some(line => {
        try { const event = JSON.parse(line) as { event?: string; name?: string }; return event.event === 'cmd_name' && event.name === 'hash-object'; }
        catch { return false; }
      })) resolve();
    });
    holder.once('error', reject);
    holder.once('exit', () => reject(new Error('Holder exited before Git readiness: ' + trace)));
  });
  const pid = new Promise<number>((resolve, reject) => {
    holder.once('message', message => {
      const value = (message as { pid: number }).pid;
      gitPid = value; resolve(value);
    });
    holder.once('error', reject);
    holder.once('exit', () => reject(new Error('Holder exited before Git PID')));
  });
  await Promise.all([ready, pid]);
  assert.equal(statSync('/proc/' + gitPid + '/fd/3').ino, inode, 'actual Git retains the lock descriptor');
  const exited = once(holder, 'exit');
  holder.kill('SIGKILL');
  await exited;
  assert.throws(() => acquireHomeLock(home), /bounded lock wait expired/, 'Git must keep the lock after holder death');
  closeSync(input); input = undefined;
  await closed;
  gitFinished = true;
  assert.equal(output.trim(), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', 'real Git completed its controlled stdin operation');
  assert.ok(trace.split('\n').some(line => {
    try { const event = JSON.parse(line) as { event?: string; code?: number }; return event.event === 'exit' && event.code === 0; }
    catch { return false; }
  }), 'Git exited normally');
  const afterGit = acquireHomeLock(home);
  afterGit.close();
  assert.equal(statSync(join(home, '.git/mypi-home.lock')).ino, inode);
});
