import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, existsSync, symlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { state } from '../support/state.js';
import { seedRepository } from '../support/repository.js';

test('registered scope, independent organizations and duplicate rollback through the public API', t => {
  const { dir, filename } = state(t);
  const checkout = join(dir, 'checkout');
  mkdirSync(checkout);
  const app = createApp(filename, false);
  try {
    const first = app.projects.add('one/project', 'MP', checkout, 'file:///nonexistent/one/project.git');
    const other = app.projects.add('two/project', 'YM', undefined, 'file:///nonexistent/two/project.git');
    assert.equal(first.checkoutPath, checkout);
    assert.equal(other.checkoutPath, null);
    assert.notEqual(first.id, other.id);
    assert.deepEqual(app.projects.resolveScope(), { type: 'global' });
    assert.equal(app.projects.resolveScope('one').type, 'org');
    assert.deepEqual(app.projects.resolveScope('one/project'), { type: 'project', project: first });
    assert.deepEqual(app.projects.list('one'), [first]);
    assert.throws(() => app.projects.add('neworg/name', 'MP', undefined, 'file:///nonexistent/neworg/name.git'), /already exists/);
    assert.throws(() => app.projects.resolveScope('neworg'), /Unknown organization/);
    assert.throws(() => app.projects.add('one/project', 'OTHER', undefined, 'file:///nonexistent/one/project.git'), /already exists/);
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
    app.projects.add('one/parent', 'P', checkout, 'file:///nonexistent/one/parent.git');
    app.projects.add('one/nested', 'N', join(checkout, 'nested'), 'file:///nonexistent/one/nested.git');
    assert.deepEqual(app.projects.resolveCheckout(join(dir, 'alias')), {
      match: 'project', identity: 'one/parent', code: 'P', scope: { type: 'project', key: 'P' }, repository: 'file:///nonexistent/one/parent.git',
    });
    assert.equal(app.projects.resolveCheckout(join(checkout, 'nested', 'src')).code, 'N');
    assert.deepEqual(app.projects.resolveCheckout(join(dir, 'repo-other')), { match: 'none' });
    app.projects.add('two/duplicate', 'D', checkout, 'file:///nonexistent/two/duplicate.git');
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
      assert.throws(() => app.projects.add(identity, 'MP', undefined, 'file:///nonexistent/one/project.git'), /Expected org\/project/);
    }
    for (const code of ['REQ', 'mp', 'MP-1', '', 'M P']) {
      assert.throws(() => app.projects.add('one/project', code, undefined, 'file:///nonexistent/one/project.git'), /Project code/);
    }
    assert.throws(() => app.projects.add('one/project', 'MP', filename, 'file:///nonexistent/one/project.git'), /directory/);
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
    const first = app.projects.add('one/project', 'MP', undefined, 'file:///nonexistent/one/project.git');
    const other = app.projects.add('two/project', 'YM', oldPath, 'file:///nonexistent/two/project.git');
    const task = app.tasks.create({ projectId: first.id, slug: 'task', title: 'Task', status: 'new' }, () => {});
    assert.throws(() => app.projects.updateCheckout('one/absent', null, newPath), /Unknown project/);
    assert.throws(() => app.projects.updateCheckout('one/project', oldPath, newPath), /Stale project checkout path/);
    assert.throws(() => app.projects.updateCheckout('one/project', null, oldPath), /already registered/);
    assert.throws(() => app.projects.updateCheckout('one/project', null, 'relative'), /absolute/);
    assert.throws(() => app.projects.updateCheckout('one/project', null, 'projects/../x'), /absolute/);
    assert.throws(() => app.projects.updateCheckout('one/project', null, 'projects//x'), /absolute/);
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
    assert.equal(app.projects.updateCheckout('one/project', newPath, 'projects/one/project').checkoutPath, 'projects/one/project');
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
    const other = 'ssh://git@host/one/project.git';
    assert.throws(() => app.projects.update('one/project', { repository: { expected: null, value: other } }), /Stale project repository/);
    assert.equal(app.projects.update('one/project', { repository: { expected: url, value: other } }).repository, other);
    assert.throws(() => app.projects.update('one/project', { repository: { expected: other, value: 'ext::sh' } }), /Invalid repository/);
    const before = app.projects.list();
    assert.throws(() => app.projects.update('one/project', { checkout: { expected: path, path },
      repository: { expected: other, value: '/srv/r.git' } }), /Stale project checkout path/);
    assert.deepEqual(app.projects.list(), before);
    const both = app.projects.update('one/project', { checkout: { expected: null, path },
      repository: { expected: other, value: '/srv/r.git' } });
    assert.deepEqual([both.checkoutPath, both.repository], [path, '/srv/r.git']);
    assert.equal(app.projects.resolveCheckout(path).repository, '/srv/r.git');
    assert.throws(() => app.projects.update('one/project', {}), /needs a checkout path or a repository/);
  } finally { app.close(); }
});

test('project add without a repository is refused and creates no row', t => {
  const { dir, filename } = state(t);
  const path = join(dir, 'checkout');
  mkdirSync(path);
  const app = createApp(filename, false);
  try {
    const refusal = { name: 'InputError',
      message: 'Project add requires a repository: the Git remote URL (CLI --repository <git-url>, MCP "repository":"<git-url>")' };
    // @ts-expect-error repository is required
    assert.throws(() => app.projects.add('one/project', 'MP'), refusal);
    // @ts-expect-error repository is required
    assert.throws(() => app.projects.add('one/project', 'MP', path), refusal);
    assert.deepEqual(app.projects.list(), []);
  } finally { app.close(); }
});

test('local is refused as a new repository in add and update', t => {
  const { filename } = state(t);
  const app = createApp(filename, false);
  try {
    const refusal = { name: 'InputError',
      message: /^Invalid repository "local": local is no longer accepted; give the Git remote URL; use https:\/\/, ssh:\/\/, file:\/\/, \[user@\]host:path or an absolute path$/ };
    assert.throws(() => app.projects.add('one/local', 'LC', undefined, 'local'), refusal);
    assert.deepEqual(app.projects.list(), []);
    const url = 'git@github.com:one/project.git';
    app.projects.add('one/project', 'MP', undefined, url);
    assert.throws(() => app.projects.update('one/project', { repository: { expected: url, value: 'local' } }), refusal);
    assert.throws(() => app.projects.update('one/project', { repository: { expected: null, value: 'local' } }), refusal);
    assert.equal(app.projects.list()[0]!.repository, url);
  } finally { app.close(); }
});

test('an existing row with local or without a repository is listed and updated away with its expected value', t => {
  const { filename } = state(t);
  const url = 'git@github.com:one/project.git';
  const write = createApp(filename, false);
  try {
    write.projects.add('one/project', 'MP', undefined, url);
    write.projects.add('one/noclone', 'NC', undefined, 'file:///nonexistent/one/noclone.git');
  } finally { write.close(); }
  seedRepository(filename, 'MP', 'local');
  seedRepository(filename, 'NC', null);
  const app = createApp(filename, false);
  try {
    assert.deepEqual(app.projects.list().map(p => [p.code, p.repository]), [['NC', null], ['MP', 'local']]);
    assert.throws(() => app.projects.update('one/project', { repository: { expected: 'local', value: 'local' } }), /local is no longer accepted/);
    assert.equal(app.projects.update('one/project', { repository: { expected: 'local', value: url } }).repository, url);
    const remote = 'https://example.test/one/noclone.git';
    assert.equal(app.projects.update('one/noclone', { repository: { expected: null, value: remote } }).repository, remote);
  } finally { app.close(); }
});

test('read APIs leave database bytes and filesystem unchanged; absent database is not initialized', t => {
  const { dir, filename } = state(t);
  const write = createApp(filename, false);
  const expected = write.projects.add('one/project', 'MP', undefined, 'file:///nonexistent/one/project.git');
  write.close();
  const before = readFileSync(filename), beforeFiles = readdirSync(dir);
  const read = createApp(filename, true);
  try {
    assert.deepEqual(read.projects.list(), [expected]);
    assert.throws(() => read.projects.add('two/project', 'YM', undefined, 'file:///nonexistent/two/project.git'), /readonly/);
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
    const project = app.projects.add('one/project', 'MP', undefined, 'file:///nonexistent/one/project.git');
    assert.throws(() => app.projects.remove('one/project', 'XX'), /Stale project code/);
    assert.deepEqual(app.projects.list(), [project]);
    assert.throws(() => app.projects.remove('one/absent', 'MP'), /Unknown project/);
    assert.deepEqual(app.projects.remove('one/project', 'MP'), project);
    assert.deepEqual(app.projects.list(), []);
    assert.equal(app.projects.resolveScope('one').type, 'org');
    app.projects.add('one/project', 'MP', undefined, 'file:///nonexistent/one/project.git');
    const referenced: [string, string, string, [string, unknown[]]][] = [
      ['tasks', 'TA', 'tasks 1', [`INSERT INTO tasks(project_id, number, title, status_id, context_dir, worktree_path, created_at, updated_at)
        VALUES ((SELECT id FROM projects WHERE code = 'TA'), 1, 'Task', (SELECT id FROM task_statuses WHERE code = 'new'),
        'projects/two/tasks/tasks/TA-1-task', NULL, ?, ?)`, [at, at]]],
      ['sessions', 'SE', 'sessions 1', [`INSERT INTO sessions(key, scope_type, project_id, task_id, agent, native_id, device, created_at)
        VALUES ('SE', 'project', (SELECT id FROM projects WHERE code = 'SE'), NULL, 'claude', 'native', 'host', ?)`, [at]]],
      ['project-journal', 'PJ', 'project journal entries 1', [`INSERT INTO knowledge_journal(at, scope_type, scope_key, event_type, text)
        VALUES (?, 'project', 'PJ', 'note', 'Note')`, [at]]],
      ['task-journal', 'TJ', 'task journal entries 1', [`INSERT INTO knowledge_journal(at, scope_type, scope_key, event_type, text)
        VALUES (?, 'task', 'TJ-1', 'note', 'Note')`, [at]]],
      ['events', 'EV', 'events 1', [`INSERT INTO events(from_key, to_key, kind, message, created_at)
        VALUES ('EV-1', 'EV', 'turn_end', 'Done', ?)`, [at]]],
    ];
    for (const [slug, code, label, statement] of referenced) {
      const dependent = app.projects.add('two/' + slug, code, undefined, 'file:///nonexistent/two/' + slug + '.git');
      seed(filename, [statement]);
      assert.throws(() => app.projects.remove('two/' + slug, code),
        new RegExp('Project ' + code + ' is referenced by: ' + label + '$'));
      assert(app.projects.list('two').some(p => p.id === dependent.id));
    }
    const prefix = app.projects.add('three/prefix', 'M', undefined, 'file:///nonexistent/three/prefix.git');
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
    app.projects.add('one/project', 'MP', undefined, 'file:///nonexistent/one/project.git');
    seed(filename, [[`INSERT INTO knowledge_journal(at, scope_type, scope_key, event_type, text) VALUES (?, 'org', 'one', 'note', 'Note')`, [at]]]);
    assert.throws(() => app.projects.removeOrganization('one'), /Organization one has projects: 1/);
    assert.throws(() => app.projects.removeOrganization('absent'), /Unknown organization/);
    assert.throws(() => app.projects.removeOrganization('Bad'), /Invalid organization slug/);
    app.projects.remove('one/project', 'MP');
    seed(filename, [[`INSERT INTO sessions(key, scope_type, org_id, agent, native_id, device, created_at)
      VALUES ('one', 'org', (SELECT id FROM organizations WHERE slug = 'one'), 'claude', 'c1', 'host', ?)`, [at]]]);
    assert.throws(() => app.projects.removeOrganization('one'), /Organization one is referenced by: sessions 1$/);
    seed(filename, [[`DELETE FROM sessions WHERE key = 'one'`, []],
      [`INSERT INTO events(from_key, to_key, kind, message, created_at) VALUES ('one', 'MP-1', 'message', 'Go', ?)`, [at]],
      [`INSERT INTO events(from_key, to_key, kind, message, created_at) VALUES ('MP-1', 'one', 'turn_end', 'Done', ?)`, [at]]]);
    assert.throws(() => app.projects.removeOrganization('one'), /Organization one is referenced by: events 2$/);
    seed(filename, [[`DELETE FROM events`, []]]);
    assert.equal(app.projects.removeOrganization('one'), 'one');
    assert.throws(() => app.projects.resolveScope('one'), /Unknown organization/);
  } finally { app.close(); }
});
