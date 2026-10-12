import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSetupPath, suggestSetupPaths } from '../../src/app/setup-paths.js';

test('setup path text resolves against explicit checkout or user home, without shell expansion', () => {
  assert.equal(normalizeSetupPath('./home/тест dir', '/check/one', '/users/a'), '/check/one/home/тест dir');
  assert.equal(normalizeSetupPath('~/data', '/check/one', '/users/a'), '/users/a/data');
  assert.equal(normalizeSetupPath('~', '/check/one', '/users/a'), '/users/a');
  assert.throws(() => normalizeSetupPath('~someone/x', '/check/one', '/users/a'));
});
test('per-checkout XDG suggestions stay deterministic and invalid explicit XDG is visible', () => {
  const first = suggestSetupPaths('/check/one', '/users/a', '/state');
  assert.deepEqual(first, suggestSetupPaths('/check/one', '/users/a', '/state'));
  assert.deepEqual(first, { homeRoot: '/check/one/home',
    database: '/state/mypi/installations/one-effa02e9/state.sqlite3',
    stateRoot: '/state/mypi/installations/one-effa02e9/runtime' });
  assert.notEqual(first.database, suggestSetupPaths('/else/one', '/users/a', '/state').database);
  assert.equal(first.homeRoot, '/check/one/home');
  assert(first.database?.startsWith('/state/mypi/installations/one-'));
  assert.equal(suggestSetupPaths('/check/one', '/users/a', 'relative').problem?.code, 'invalid-xdg');
  assert.equal(suggestSetupPaths('/check/one', '/users/a', 'relative').database, undefined);
});
