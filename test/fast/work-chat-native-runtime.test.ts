import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyContinuity, exactCatalogModel, finalEmptySnapshot, nativeHistory, readyAuth, startupReceipt } from '../../src/app/native-chat-facts.js';

const catalog = 'provider       model                         context  max-out  thinking  images\n'
  + 'openai-codex   gpt-6-sol                     256K     16K      yes       yes\n'
  + 'custom        path/model-id                 32K      4K       no        no\n';
test('target catalog requires whole exact provider/model IDs and complete six-column output', () => {
  assert.equal(exactCatalogModel(catalog, { provider: 'custom', model: 'path/model-id' }), true);
  assert.equal(exactCatalogModel(catalog, { provider: 'custom', model: 'model-id' }), false);
  assert.equal(exactCatalogModel(catalog, { provider: 'openai-codex', model: 'gpt-6' }), false);
  assert.equal(exactCatalogModel(catalog, { provider: 'OPENAI-CODEX', model: 'gpt-6-sol' }), false);
  assert.throws(() => exactCatalogModel('No models matching gpt-6', { provider: 'openai-codex', model: 'gpt-6-sol' }));
  assert.throws(() => exactCatalogModel(catalog + 'garbled\n', { provider: 'openai-codex', model: 'gpt-6-sol' }));
  assert.throws(() => exactCatalogModel(catalog + catalog.split('\n')[1] + '\n', { provider: 'openai-codex', model: 'gpt-6-sol' }));
});
test('auth requires structured ready for exact provider, never bearer credentials', () => {
  assert.equal(readyAuth('{"status":"ready","provider":"custom","authType":"api_key"}', 'custom'), true);
  assert.equal(readyAuth('{"status":"ready","provider":"other","authType":"oauth"}', 'custom'), false);
  assert.equal(readyAuth('{"status":"not_ready","provider":"custom"}', 'custom'), false);
  assert.equal(readyAuth('{"status":"ready"}', 'custom'), false);
  assert.throws(() => readyAuth('not JSON', 'custom'));
});
test('startup receipt matches actual process, model and scope even for live empty history', () => {
  const expected = { processId: 21, scope: 'team/tool', model: { provider: 'custom', model: 'path/model-id' } };
  const receipt = { ...expected, lifecycle: 'start:startup', fileExists: true };
  assert.equal(startupReceipt(receipt, expected), true);
  assert.equal(startupReceipt({ ...receipt, lifecycle: 'model_select' }, expected), false);
  assert.equal(startupReceipt({ ...receipt, model: { provider: 'custom', model: 'path/model' } }, expected), false);
  assert.equal(startupReceipt({ ...receipt, error: 'registry mismatch' }, expected), false);
  assert.equal(startupReceipt({ ...receipt, processId: 22 }, expected), false);
  assert.equal(startupReceipt({ ...receipt, fileExists: false }, expected), true);
  const placeholder = { lifecycle: 'start:startup', processId: 21, scope: 'team/tool', fileExists: false, authReady: false };
  assert.equal(startupReceipt(placeholder, { processId: 21, scope: 'team/tool', authReady: false }), true);
  assert.equal(startupReceipt(placeholder, expected), false);
  assert.equal(startupReceipt({ ...placeholder, authReady: true }, { processId: 21, scope: 'team/tool', authReady: false }), false);
  const unpinned = { ...placeholder, model: { provider: 'other', model: 'automatic' }, authReady: true };
  assert.equal(startupReceipt(unpinned, { processId: 21, scope: 'team/tool', allowUnpinned: true }), true);
  assert.equal(startupReceipt(unpinned, expected), false);
  assert.equal(startupReceipt({ ...unpinned, error: 'bad target' }, { processId: 21, scope: 'team/tool', allowUnpinned: true }), false);
  assert.equal(startupReceipt(receipt, { processId: 21, scope: 'team/tool', allowUnpinned: true }), false);
});
test('public all-entries snapshot refuses user-only/off-branch turns even after file deletion', () => {
  const header = { id: 'session-a', cwd: '/task' };
  const setup = [{ type: 'model_change' }, { type: 'thinking_level_change' }];
  assert.equal(finalEmptySnapshot(header, setup, 'session-a', '/task'), true);
  assert.equal(finalEmptySnapshot(header, [...setup, { type: 'message', message: { role: 'user' } }], 'session-a', '/task'), false);
  assert.equal(finalEmptySnapshot(header, [...setup, { type: 'message', message: { role: 'assistant' } }], 'session-a', '/task'), false);
  assert.equal(finalEmptySnapshot(header, [...setup, { type: 'custom' }], 'session-a', '/task'), false);
  assert.equal(finalEmptySnapshot(null, setup, 'session-a', '/task'), false);
  const initial = { lifecycle: 'start:startup', sessionId: 'session-a', historyPath: '/state/sessions/a', processId: 20, fileExists: false };
  const first = { ...initial, ...emptyContinuity(undefined, initial) };
  const final = { ...initial, lifecycle: 'shutdown:quit', finalEmpty: true };
  assert.equal(emptyContinuity(first, final).provenEmpty, true);
  assert.equal(emptyContinuity(first, { ...final, finalEmpty: false }).provenEmpty, false);
  assert.equal(emptyContinuity(first, { ...final, lifecycle: 'shutdown:reload' }).provenEmpty, false);
  const reloading = { ...first, lifecycle: 'shutdown:reload', continuous: true };
  assert.equal(emptyContinuity(reloading, { ...initial, lifecycle: 'start:reload' }).continuous, true);
  assert.equal(emptyContinuity(first, { ...final, sessionId: 'another' }).provenEmpty, false);
  const observedHistory = { ...first, ...emptyContinuity(first, { ...initial, fileExists: true }) };
  assert.equal(emptyContinuity(observedHistory, final).provenEmpty, false);
  assert.equal(emptyContinuity(undefined, final).provenEmpty, false);
});
test('saved model follows native parent branch; foreign header and corrupt ancestry refuse', () => {
  const row = (value: object) => JSON.stringify(value);
  const header = row({ type: 'session', version: 3, id: 'session-a', cwd: '/task' });
  const one = row({ type: 'model_change', id: 'a', parentId: null, provider: 'custom', modelId: 'first' });
  const foreign = row({ type: 'model_change', id: 'b', parentId: 'a', provider: 'custom', modelId: 'foreign' });
  const leaf = row({ type: 'custom', id: 'c', parentId: 'a' });
  assert.deepEqual(nativeHistory([header, one, foreign, leaf].join('\n'), 'session-a', '/task'),
    { status: 'selected', selection: { provider: 'custom', model: 'first' } });
  assert.deepEqual(nativeHistory(header, 'session-a', '/task'), { status: 'none' });
  assert.throws(() => nativeHistory(header, 'session-b', '/task'));
  assert.throws(() => nativeHistory([header, row({ type: 'custom', id: 'c', parentId: 'absent' })].join('\n'), 'session-a', '/task'));
  const binding = { installation: '/engine', state: '/state', scope: 'team/tool' };
  assert.throws(() => nativeHistory([header, one].join('\n'), 'session-a', '/task', binding), /no matching scoped binding/);
  const scoped = row({ type: 'custom', customType: 'mypi-startup-binding', data: binding, id: 'bound', parentId: 'a' });
  assert.deepEqual(nativeHistory([header, one, scoped].join('\n'), 'session-a', '/task', binding),
    { status: 'selected', selection: { provider: 'custom', model: 'first' } });
  assert.throws(() => nativeHistory([header, one, scoped].join('\n'), 'session-a', '/task', { ...binding, scope: 'team/other' }), /another installation/);
  assert.throws(() => nativeHistory([header, one, scoped, row({ type: 'custom', id: 'other', parentId: 'a' })].join('\n'), 'session-a', '/task', binding), /no matching scoped binding/);
});
