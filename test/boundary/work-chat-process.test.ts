import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectAbsentPaneProcess } from '../../src/app/native-chat-runtime.js';
import { readNativeProcess } from '../../src/app/native-chat-process.js';
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('actual procfs captures current executable/start/boot and distinguishes a reaped process from a live missing-pane process', () => {
  const actual = readNativeProcess(process.pid);
  assert.equal(actual.pid, process.pid);
  assert.equal(actual.executable, realpathSync(process.execPath));
  assert.equal(actual.cwd, realpathSync(process.cwd()));
  assert.match(actual.start, /^\d+$/);
  assert.match(actual.boot, /^[\da-f-]{36}$/);
  assert.equal(inspectAbsentPaneProcess(process.pid).status, 'unknown');
  const child = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8', timeout: 2000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(inspectAbsentPaneProcess(Number(child.stdout.trim())).status, 'dead');
});

test('absent pane PID is dead only on verified procfs absence; unreadable, malformed and reused PID remain unknown', () => {
  const missing = Object.assign(new Error('missing stat'), { code: 'ENOENT' });
  const validStat = `42 (new process) ${Array(19).fill('0').join(' ')} 987654 0`;
  assert.equal(inspectAbsentPaneProcess(42, path => {
    if (path === '/proc/42/stat') throw missing;
    return validStat;
  }).status, 'dead');
  assert.equal(inspectAbsentPaneProcess(42, () => { throw missing; }).status, 'unknown');
  for (const error of [Object.assign(new Error('denied'), { code: 'EACCES' }),
    Object.assign(new Error('I/O failure'), { code: 'EIO' })]) {
    assert.equal(inspectAbsentPaneProcess(42, () => { throw error; }).status, 'unknown');
  }
  assert.equal(inspectAbsentPaneProcess(42, () => 'malformed').status, 'unknown');
  assert.equal(inspectAbsentPaneProcess(42, () => validStat).status, 'unknown');
});
