import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../src/app/create-app.js';
import { state } from '../support/state.js';

test('registered scope, independent organizations and duplicate rollback through the public API', t => {
  const { dir, filename } = state(t);
  const checkout = join(dir, 'checkout');
  mkdirSync(checkout);
  const app = createApp(filename, false);
  try {
    const first = app.projects.add('one/project', 'MP', checkout);
    const other = app.projects.add('two/project', 'YM');
    assert.equal(first.checkoutPath, checkout);
    assert.equal(other.checkoutPath, null);
    assert.notEqual(first.id, other.id);
    assert.deepEqual(app.projects.resolveScope(), { type: 'global' });
    assert.equal(app.projects.resolveScope('one').type, 'org');
    assert.deepEqual(app.projects.resolveScope('one/project'), { type: 'project', project: first });
    assert.deepEqual(app.projects.list('one'), [first]);
    assert.throws(() => app.projects.add('neworg/name', 'MP'), /already exists/);
    assert.throws(() => app.projects.resolveScope('neworg'), /Unknown organization/);
    assert.throws(() => app.projects.add('one/project', 'OTHER'), /already exists/);
    assert.throws(() => app.projects.resolveScope('one/unknown'), /Unknown project/);
    assert.deepEqual(app.projects.list(), [first, other]);
  } finally { app.close(); }
});

test('checkout lookup uses canonical component boundaries, deepest match and explicit ambiguity', t => {
  const { dir, filename } = state(t), checkout = join(dir, 'repo');
  mkdirSync(join(checkout, 'nested', 'src'), { recursive: true });
  mkdirSync(join(dir, 'repo-other'));
  symlinkSync(checkout, join(dir, 'alias'));
  const app = createApp(filename, false);
  try {
    app.projects.add('one/parent', 'P', checkout);
    app.projects.add('one/nested', 'N', join(checkout, 'nested'));
    assert.deepEqual(app.projects.resolveCheckout(join(dir, 'alias')), {
      match: 'project', identity: 'one/parent', code: 'P', scope: { type: 'project', key: 'P' },
    });
    assert.equal(app.projects.resolveCheckout(join(checkout, 'nested', 'src')).code, 'N');
    assert.deepEqual(app.projects.resolveCheckout(join(dir, 'repo-other')), { match: 'none' });
    app.projects.add('two/duplicate', 'D', checkout);
    const ambiguous = app.projects.resolveCheckout(checkout);
    assert.equal(ambiguous.match, 'ambiguous');
    assert.equal(ambiguous.projects?.length, 2);
    assert.throws(() => app.projects.resolveCheckout(filename), /directory/);
  } finally { app.close(); }
});

test('invalid identities/codes never register an organization or create context', t => {
  const { dir, filename } = state(t);
  const app = createApp(filename, false);
  try {
    for (const identity of ['../outside', 'org', 'org/name/extra', '/org/name', 'org/..', 'org/a\\b', 'org/\0']) {
      assert.throws(() => app.projects.add(identity, 'MP'), /Expected org\/project/);
    }
    for (const code of ['REQ', 'mp', 'MP-1', '', 'M P']) {
      assert.throws(() => app.projects.add('one/project', code), /Project code/);
    }
    assert.throws(() => app.projects.add('one/project', 'MP', filename), /directory/);
    assert.deepEqual(app.projects.list(), []);
    assert.deepEqual(readdirSync(dir), ['state.sqlite3']);
  } finally { app.close(); }
});

test('read APIs leave database bytes and filesystem unchanged; absent database is not initialized', t => {
  const { dir, filename } = state(t);
  const write = createApp(filename, false);
  const expected = write.projects.add('one/project', 'MP');
  write.close();
  const before = readFileSync(filename);
  const read = createApp(filename, true);
  try {
    assert.deepEqual(read.projects.list(), [expected]);
    assert.throws(() => read.projects.add('two/project', 'YM'), /readonly/);
    let sourceCalled = false;
    assert.throws(() => read.requests.create({ projectId: null, title: 'Read only', status: 'new', slug: 'readonly' },
      () => { sourceCalled = true; }), /readonly/i);
    assert.equal(sourceCalled, false, 'readonly must reject before source writes');
  } finally { read.close(); }
  assert.deepEqual(readFileSync(filename), before);
  assert.deepEqual(readdirSync(dir), ['state.sqlite3']);
  const missing = join(dir, 'absent', 'state.sqlite3');
  assert.throws(() => createApp(missing, true));
  assert.equal(existsSync(join(dir, 'absent')), false);
});
