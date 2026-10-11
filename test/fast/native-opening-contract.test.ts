import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNativeOpeningRequest, parseNativeOpeningResponse, nativeOpeningReceipt } from '../../src/app/native-opening-contract.js';

test('native opening transport rejects malformed acknowledgements and preserves typed conflict/partial data', () => {
  const installation = { version: 1, engineRoot: '/engine', homeRoot: '/home', database: '/state/db',
    stateRoot: '/state', configPath: '/engine/.mypi-local.json', sessionDirectory: '/state/sessions', mailboxDirectory: '/state/mailbox' };
  assert.deepEqual(parseNativeOpeningRequest({ installation, callerCwd: '/root', project: 'one/app' }),
    { installation, callerCwd: '/root', project: 'one/app' });
  assert.throws(() => parseNativeOpeningRequest({ installation, callerCwd: 'relative' }), /Invalid native/);
  const conflict = { ok: false, error: { state: 'observed-conflict', message: 'Choose',
    conflicts: [{ instanceKey: 'one', status: 'stale' }] } };
  const partial = { ok: false, error: { state: 'partial', message: 'Inspect', stage: 'submit',
    herdrSocketPath: '/run/herdr.sock', tabId: 't1', paneId: 'p1' } };
  assert.deepEqual(parseNativeOpeningResponse(conflict), conflict);
  assert.deepEqual(parseNativeOpeningResponse(partial), partial);
  const submitted = { ok: true, value: { state: 'submitted', choice: { project: 'one/app', worktree: '/task', branch: 'task/a' },
    receipt: { status: 'submitted', herdrSocketPath: '/run/herdr.sock', tabId: 't1', paneId: 'p1' } } };
  assert.deepEqual(nativeOpeningReceipt(JSON.stringify(submitted), true, false), { ok: false,
    error: { state: 'partial', stage: 'unknown', message: 'Node opening execution interrupted or cancelled; inspect Herdr before retrying.',
      herdrSocketPath: '/run/herdr.sock', tabId: 't1', paneId: 'p1' } });
  assert.equal(nativeOpeningReceipt(JSON.stringify(submitted), false, true).ok, false);
  assert.deepEqual(nativeOpeningReceipt(JSON.stringify(partial), true, true), partial);
  assert.equal(nativeOpeningReceipt('not-json', true, false).ok, false);
  for (const invalid of [null, {}, { ok: true }, { ok: true, value: { state: 'submitted' } },
    { ok: false, error: { state: 'partial', message: 'Inspect' } }, { ok: false, error: { state: 'observed-conflict', message: 'Choose' } }]) {
    assert.throws(() => parseNativeOpeningResponse(invalid), /Invalid native/);
  }
});
