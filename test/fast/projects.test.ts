import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, existsSync, symlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
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
      match: 'project', identity: 'one/parent', code: 'P', scope: { type: 'project', key: 'P' }, repository: null,
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
    assert.deepEqual(readdirSync(dir), ['state.sqlite3', 'state.sqlite3-shm', 'state.sqlite3-wal']);
  } finally { app.close(); }
});

test('project checkout update preserves identity and tasks, rejects stale and duplicate paths without rewriting history', t => {
  const { dir, filename } = state(t);
  const oldPath = join(dir, 'old'), newPath = join(dir, 'new');
  mkdirSync(oldPath); mkdirSync(newPath);
  symlinkSync(newPath, join(dir, 'alias'));
  const app = createApp(filename, false);
  try {
    const first = app.projects.add('one/project', 'MP');
    const other = app.projects.add('two/project', 'YM', oldPath);
    const task = app.tasks.create({ projectId: first.id, slug: 'task', title: 'Task', status: 'new' }, () => {});
    assert.throws(() => app.projects.updateCheckout('one/absent', null, newPath), /Unknown project/);
    assert.throws(() => app.projects.updateCheckout('one/project', oldPath, newPath), /Stale project checkout path/);
    assert.throws(() => app.projects.updateCheckout('one/project', null, oldPath), /already registered/);
    assert.throws(() => app.projects.updateCheckout('one/project', null, 'relative'), /absolute/);
    assert.throws(() => app.projects.updateCheckout('one/project', null, join(dir, 'missing')), /ENOENT/);
    assert.throws(() => app.projects.updateCheckout('one/project', null, filename), /directory/);
    const updated = app.projects.updateCheckout('one/project', null, join(dir, 'alias'));
    assert.deepEqual(updated, { ...first, checkoutPath: newPath });
    assert.deepEqual(app.projects.list(), [updated, other]);
    assert.deepEqual(app.tasks.get(task.id), task);
    assert.throws(() => app.projects.updateCheckout('one/project', null, oldPath), /Stale project checkout path/);
    assert.throws(() => app.projects.updateCheckout('one/project', newPath, oldPath), /already registered/);
    assert.deepEqual(app.projects.list(), [updated, other]);
    assert.deepEqual(app.tasks.get(task.id), task);
    let standalone = false;
    assert.throws(() => app.tasks.create({ projectId: null, slug: 'standalone', title: 'Standalone', status: 'new' }, () => { standalone = true; }), /Project required/);
    assert.equal(standalone, false);
  } finally { app.close(); }
});

test('project repository is validated, stored, listed, resolved and updated with an expected value', t => {
  const { dir, filename } = state(t);
  const path = join(dir, 'checkout');
  mkdirSync(path);
  const app = createApp(filename, false);
  try {
    const url = 'git@github.com:one/project.git';
    assert.equal(app.projects.add('one/project', 'MP', undefined, url).repository, url);
    assert.equal(app.projects.list()[0]!.repository, url);
    assert.throws(() => app.projects.add('one/bad', 'BD', undefined, 'ext::sh'), /Invalid repository/);
    assert.deepEqual(app.projects.list().map(p => p.code), ['MP']);
    assert.throws(() => app.projects.update('one/project', { repository: { expected: null, value: 'local' } }), /Stale project repository/);
    assert.equal(app.projects.update('one/project', { repository: { expected: url, value: 'local' } }).repository, 'local');
    assert.throws(() => app.projects.update('one/project', { repository: { expected: 'local', value: 'ext::sh' } }), /Invalid repository/);
    const before = app.projects.list();
    assert.throws(() => app.projects.update('one/project', { checkout: { expected: path, path },
      repository: { expected: 'local', value: '/srv/r.git' } }), /Stale project checkout path/);
    assert.deepEqual(app.projects.list(), before);
    const both = app.projects.update('one/project', { checkout: { expected: null, path },
      repository: { expected: 'local', value: '/srv/r.git' } });
    assert.deepEqual([both.checkoutPath, both.repository], [path, '/srv/r.git']);
    assert.equal(app.projects.resolveCheckout(path).repository, '/srv/r.git');
    assert.throws(() => app.projects.update('one/project', {}), /needs a checkout path or a repository/);
  } finally { app.close(); }
});

test('read APIs leave database bytes and filesystem unchanged; absent database is not initialized', t => {
  const { dir, filename } = state(t);
  const write = createApp(filename, false);
  const expected = write.projects.add('one/project', 'MP');
  write.close();
  const before = readFileSync(filename), beforeFiles = readdirSync(dir);
  const read = createApp(filename, true);
  try {
    assert.deepEqual(read.projects.list(), [expected]);
    assert.throws(() => read.projects.add('two/project', 'YM'), /readonly/);
    let sourceCalled = false;
    assert.throws(() => read.tasks.create({ projectId: expected.id, title: 'Read only', status: 'new', slug: 'readonly' },
      () => { sourceCalled = true; }), /readonly/i);
    assert.equal(sourceCalled, false, 'readonly must reject before source writes');
  } finally { read.close(); }
  assert.deepEqual(readFileSync(filename), before);
  const afterFiles = readdirSync(dir);
  const added = afterFiles.filter(name => !beforeFiles.includes(name));
  assert(added.every(name => name === 'state.sqlite3-wal' || name === 'state.sqlite3-shm'));
  assert.deepEqual(beforeFiles.filter(name => !afterFiles.includes(name)), []);
  for (const name of added) assert(statSync(join(dir, name)).isFile(), 'SQLite sidecar must be a regular file');
  assert.equal(statSync(dir).mode & 0o777, 0o700, 'SQLite sidecars remain inside the private state directory');
  const missing = join(dir, 'absent', 'state.sqlite3');
  assert.throws(() => createApp(missing, true));
  assert.equal(existsSync(join(dir, 'absent')), false);
});

const at = '2026-10-28T00:00:00.000Z';

function seed(filename: string, statements: [string, unknown[]][]) {
  const db = openDatabase(filename);
  try {
    for (const [sql, params] of statements) db.prepare(sql).run(...params);
  } finally { db.close(); }
}

test('project remove deletes only an unreferenced registration and refuses every dependent record', t => {
  const { filename } = state(t);
  const app = createApp(filename, false);
  try {
    const project = app.projects.add('one/project', 'MP');
    assert.throws(() => app.projects.remove('one/project', 'XX'), /Stale project code/);
    assert.deepEqual(app.projects.list(), [project]);
    assert.throws(() => app.projects.remove('one/absent', 'MP'), /Unknown project/);
    assert.deepEqual(app.projects.remove('one/project', 'MP'), project);
    assert.deepEqual(app.projects.list(), []);
    assert.equal(app.projects.resolveScope('one').type, 'org');
    app.projects.add('one/project', 'MP');
    const referenced: [string, string, string, [string, unknown[]]][] = [
      ['tasks', 'TA', 'tasks 1', [`INSERT INTO tasks(project_id, number, title, status_id, context_dir, worktree_path, created_at, updated_at)
        VALUES ((SELECT id FROM projects WHERE code = 'TA'), 1, 'Task', (SELECT id FROM task_statuses WHERE code = 'new'),
        'projects/two/tasks/tasks/TA-1-task', NULL, ?, ?)`, [at, at]]],
      ['sessions', 'SE', 'sessions 1', [`INSERT INTO sessions(key, scope_type, project_id, task_id, agent, native_id, created_at)
        VALUES ('SE', 'project', (SELECT id FROM projects WHERE code = 'SE'), NULL, 'claude', 'native', ?)`, [at]]],
      ['project-journal', 'PJ', 'project journal entries 1', [`INSERT INTO knowledge_journal(at, scope_type, scope_key, event_type, text)
        VALUES (?, 'project', 'PJ', 'note', 'Note')`, [at]]],
      ['task-journal', 'TJ', 'task journal entries 1', [`INSERT INTO knowledge_journal(at, scope_type, scope_key, event_type, text)
        VALUES (?, 'task', 'TJ-1', 'note', 'Note')`, [at]]],
      ['events', 'EV', 'events 1', [`INSERT INTO events(from_key, to_key, kind, message, created_at)
        VALUES ('EV-1', 'EV', 'turn_end', 'Done', ?)`, [at]]],
    ];
    for (const [slug, code, label, statement] of referenced) {
      const dependent = app.projects.add('two/' + slug, code);
      seed(filename, [statement]);
      assert.throws(() => app.projects.remove('two/' + slug, code),
        new RegExp('Project ' + code + ' is referenced by: ' + label + '$'));
      assert(app.projects.list('two').some(p => p.id === dependent.id));
    }
    const prefix = app.projects.add('three/prefix', 'M');
    seed(filename, [
      [`INSERT INTO knowledge_journal(at, scope_type, scope_key, event_type, text) VALUES (?, 'task', 'MP-1', 'note', 'Note')`, [at]],
      [`INSERT INTO events(from_key, to_key, kind, message, created_at) VALUES ('MP-1', 'MP', 'turn_end', 'Done', ?)`, [at]],
    ]);
    assert.deepEqual(app.projects.remove('three/prefix', 'M'), prefix);
  } finally { app.close(); }
});

test('org remove deletes only an organization without projects', t => {
  const { filename } = state(t);
  const app = createApp(filename, false);
  try {
    app.projects.add('one/project', 'MP');
    seed(filename, [[`INSERT INTO knowledge_journal(at, scope_type, scope_key, event_type, text) VALUES (?, 'org', 'one', 'note', 'Note')`, [at]]]);
    assert.throws(() => app.projects.removeOrganization('one'), /Organization one has projects: 1/);
    assert.throws(() => app.projects.removeOrganization('absent'), /Unknown organization/);
    assert.throws(() => app.projects.removeOrganization('Bad'), /Invalid organization slug/);
    app.projects.remove('one/project', 'MP');
    assert.equal(app.projects.removeOrganization('one'), 'one');
    assert.throws(() => app.projects.resolveScope('one'), /Unknown organization/);
  } finally { app.close(); }
});
