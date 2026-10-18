import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectAbsentPaneProcess } from '../../src/app/native-chat-runtime.js';

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
