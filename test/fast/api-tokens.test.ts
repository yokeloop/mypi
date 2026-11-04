import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { state } from '../support/state.js';
import { InputError } from '../../src/shared/errors.js';
import { createApiToken, listApiTokens, resolveApiTokensPath, revokeApiToken, verifyApiToken } from '../../src/app/api-tokens.js';

test('API tokens are created once, stored only as hashes in a private file, verified, listed and revoked', t => {
  const { dir } = state(t);
  const file = join(dir, 'config/mypi/api-tokens.json');
  const reader = createApiToken(file, { tokenName: 'phone', permission: 'read' });
  assert.match(reader.token, /^mypi_[A-Za-z0-9_-]{43}$/);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(file)).mode & 0o777, 0o700);
  assert.equal(readFileSync(file, 'utf8').includes(reader.token), false);
  assert.deepEqual(verifyApiToken(file, reader.token), { name: 'phone', permission: 'read', sender: null });
  assert.equal(verifyApiToken(file, reader.token + 'x'), undefined);
  assert.equal(createApiToken(file, { tokenName: 'agent', permission: 'write' }).sender, 'global');
  assert.equal(createApiToken(file, { tokenName: 'project-agent', permission: 'write', sender: 'MP' }).sender, 'MP');
  for (const input of [
    { tokenName: 'phone', permission: 'read' }, { tokenName: 'admin', permission: 'admin' },
    { tokenName: 'reader', permission: 'read', sender: 'global' }, { tokenName: 'task', permission: 'write', sender: 'mp-1' },
    { tokenName: 'Bad Name', permission: 'read' },
  ]) assert.throws(() => createApiToken(file, input), InputError);
  const listed = listApiTokens(file);
  assert.deepEqual(listed.tokens.map(x => x.name), ['phone', 'agent', 'project-agent']);
  for (const row of listed.tokens) assert.deepEqual(Object.keys(row).sort(), ['createdAt', 'name', 'permission', 'sender']);
  assert.deepEqual(revokeApiToken(file, 'phone'), { revoked: 'phone' });
  assert.equal(verifyApiToken(file, reader.token), undefined);
  assert.throws(() => revokeApiToken(file, 'phone'), InputError);
  chmodSync(file, 0o644);
  assert.throws(() => verifyApiToken(file, reader.token), /must be a private regular file/);
  assert.throws(() => createApiToken(file, { tokenName: 'later', permission: 'read' }), /must be a private regular file/);
  assert.equal(resolveApiTokensPath({ HOME: '/home/u' }), '/home/u/.config/mypi/api-tokens.json');
  assert.equal(resolveApiTokensPath({ XDG_CONFIG_HOME: '/c', HOME: '/home/u' }), '/c/mypi/api-tokens.json');
  assert.throws(() => resolveApiTokensPath({ XDG_CONFIG_HOME: 'rel' }), InputError);
});
