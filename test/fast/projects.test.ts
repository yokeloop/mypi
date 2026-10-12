import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../src/app/create-app.js';
import { state } from '../support/state.js';
import { commandMembership } from '../../src/app/command-membership.js';
import type { AppCommand, WorkContext } from '../../src/app/commands.js';
import { DEFAULT_GUARD_POLICY } from '../../src/modules/work-context/public.js';

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

test('command membership uses current registry IDs and card owners, with distinct defaults and explicit targets', t => {
  const { filename } = state(t), app = createApp(filename, false);
  try {
    const own = app.projects.add('one/project', 'YM'), foreign = app.projects.add('two/project', 'MP');
    const a = app.requests.create({ projectId: own.id, title: 'Own', status: 'new', slug: 'own' }, () => {});
    const b = app.requests.create({ projectId: foreign.id, title: 'Foreign', status: 'new', slug: 'foreign' }, () => {});
    app.requests.create({ projectId: null, title: 'Standalone', status: 'new', slug: 'standalone' }, () => {});
    assert.equal(a.projectId, own.id); assert.equal(b.projectId, foreign.id);
    const context: WorkContext = { scope: { kind: 'project', project: 'one/project' } };
    const org: WorkContext = { scope: { kind: 'organization', organization: 'one' } };
    const decide = (command: AppCommand, selected = context) => commandMembership(command, app, selected, DEFAULT_GUARD_POLICY);
    for (const command of [
      { name: 'request_show', key: 'YM-1' }, { name: 'request_touch', key: 'YM-1' },
      { name: 'journal_read', scope: { type: 'request', key: 'YM-1' } },
      { name: 'warmup', scope: { type: 'global' } }, { name: 'memory_show', scope: { type: 'org', key: 'one' } },
      { name: 'error_add', project: 'one/project', text: 'fact' },
    ] satisfies AppCommand[]) assert.deepEqual(decide(command).warnings, []);
    for (const command of [
      { name: 'request_show', key: 'MP-1' }, { name: 'request_touch', key: 'REQ-1' },
      { name: 'journal_add', scope: { type: 'request', key: 'MP-1' }, text: 'foreign' },
      { name: 'memory_add', scope: { type: 'global' }, text: 'global' },
      { name: 'memory_add', scope: { type: 'org', key: 'one' }, text: 'shared' },
      { name: 'warmup', scope: { type: 'project', key: 'MP' } },
      { name: 'project_list', org: 'two' }, { name: 'request_list', project: 'two/project' },
    ] satisfies AppCommand[]) assert.throws(() => decide(command), /outside the working selection/);
    assert.deepEqual(decide({ name: 'memory_add', text: 'own' }).command,
      { name: 'memory_add', text: 'own', scope: { type: 'project', key: 'YM' } });
    assert.deepEqual(decide({ name: 'warmup' }, org).command, { name: 'warmup', scope: { type: 'org', key: 'one' } });
    const create = { name: 'request_create', title: 'T', status: 'new', slug: 't', source: { text: 's' } } as const;
    assert.deepEqual(decide(create).command, { ...create, project: 'one/project' });
    assert.throws(() => decide({ ...create, project: null }), /outside the working selection/);
    assert.throws(() => decide(create, org), /concrete project/);
    assert.deepEqual(decide({ name: 'request_list' }, org).listProjectIds, [own.id]);
    const added = app.projects.add('one/added', 'NEW');
    assert.deepEqual(decide({ name: 'request_list' }, org).listProjectIds, [added.id, own.id]);
    const selectedOrg = { ...org, selectedProject: 'one/project' };
    assert.deepEqual(decide({ name: 'project_list' }, selectedOrg).listProjectIds, [own.id]);
    assert.deepEqual(decide({ name: 'project_list', org: 'one' }, selectedOrg).listProjectIds, [added.id, own.id]);
    assert.deepEqual(decide({ ...create, project: 'one/added' }, selectedOrg).warnings, []);
    assert.throws(() => decide({ name: 'project_list' }, { ...context, selectedProject: 'two/project' }), /outside the working selection/);
    assert.throws(() => decide({ name: 'project_list' }, { scope: { kind: 'project', project: 'absent/project' } }), /Unknown project/);
    const warn = commandMembership({ name: 'request_show', key: 'MP-1' }, app, context,
      { version: 2, guards: { ...DEFAULT_GUARD_POLICY.guards, foreignMypiTarget: 'warn' } });
    assert.equal(warn.warnings[0]?.behavior, 'warn');
    assert.equal(warn.warnings[0].guard, 'foreignMypiTarget');
  } finally { app.close(); }
});
