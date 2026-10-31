import test from 'node:test';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeDatabase, openDatabase } from '../../src/infrastructure/database/database.js';
import { snapshotDatabase } from '../../src/infrastructure/database/backup.js';
import { createApp } from '../../src/app/create-app.js';
import { state } from '../support/state.js';

test('STRICT types, relational uniqueness and foreign keys are enforced by real SQLite', t => {
  const { filename } = state(t);
  const app = createApp(filename, false);
  const p = app.projects.add('one/project', 'MP');
  app.close();
  const db = openDatabase(filename);
  t.diagnostic(JSON.stringify({ node: process.versions.node, sqlite: db.prepare('SELECT sqlite_version() AS version').get() }));
  try {
    const insert = db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, created_at, updated_at)
      VALUES (?, ?, 'Title', ?, ?, '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z')`);
    const status = (db.prepare("SELECT id FROM task_statuses WHERE code = 'new'").get() as { id: number }).id;
    insert.run(p.id, 1, status, 'projects/one/project/tasks/MP-1-first');
    insert.run(null, 1, status, 'tasks/REQ-1-first');
    assert.throws(() => insert.run(null, 1, status, 'tasks/REQ-1-duplicate'), /UNIQUE/);
    assert.throws(() => insert.run(p.id, 1, status, 'projects/one/project/tasks/MP-1-other'), /UNIQUE/);
    assert.throws(() => insert.run(null, 2, status, 'tasks/REQ-1-first'), /UNIQUE/);
    for (const bad of [0, -1, 1.5, 'bad']) assert.throws(() => insert.run(null, bad, status, 'tasks/bad'));
    assert.throws(() => insert.run(999, 2, status, 'tasks/bad'), /FOREIGN KEY/);
    assert.throws(() => insert.run(null, 2, 999, 'tasks/bad'), /FOREIGN KEY/);
    assert.throws(() => insert.run(null, 2, null, 'tasks/bad'), /NOT NULL/);
    assert.throws(() => db.prepare('DELETE FROM projects WHERE id = ?').run(p.id), /FOREIGN KEY/);
    assert.throws(() => db.prepare('DELETE FROM organizations').run(), /FOREIGN KEY/);
    assert.throws(() => db.prepare('DELETE FROM task_statuses WHERE id = ?').run(status), /FOREIGN KEY/);
    assert.throws(() => db.prepare('UPDATE task_statuses SET is_terminal = 1 WHERE id = ?').run(status), /terminality/);
    assert.throws(() => db.prepare("UPDATE projects SET code = 'YM' WHERE id = ?").run(p.id), /rename/);
    assert.throws(() => db.prepare('DELETE FROM tasks').run(), /cannot be deleted/);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('requests','request_statuses','requests_unassigned_number','preserve_request_numbers')").all(), []);
    assert.equal((db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).some(c => c.name === 'worktree_path'), true);
  } finally { db.close(); }
});

test('readonly connection observes committed rows in an active writer WAL without write access', t => {
  const { filename } = state(t);
  const writer = openDatabase(filename);
  try {
    writer.pragma('wal_autocheckpoint = 0');
    writer.prepare("INSERT INTO organizations(slug) VALUES ('visible')").run();
    const reader = openDatabase(filename, true);
    try {
      assert.equal(reader.pragma('journal_mode', { simple: true }), 'wal');
      assert.deepEqual(reader.prepare('SELECT slug FROM organizations WHERE slug = ?').get('visible'), { slug: 'visible' });
      assert.throws(() => reader.prepare("INSERT INTO organizations(slug) VALUES ('forbidden')").run(), /readonly/i);
      assert.equal((reader.pragma('user_version', { simple: true }) as number), 9);
    } finally { reader.close(); }
  } finally { writer.close(); }
});

test('initialization is a no-op on a current database and rejects a newer schema', t => {
  const { filename } = state(t);
  let db = openDatabase(filename);
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.deepEqual(db.prepare('SELECT code, is_terminal FROM task_statuses ORDER BY id').all(),
    ['new', 'research', 'planning', 'in_progress', 'review', 'blocked', 'paused', 'done', 'failed', 'cancelled']
      .map(code => ({ code, is_terminal: ['done', 'failed', 'cancelled'].includes(code) ? 1 : 0 })));
  db.prepare("UPDATE task_statuses SET code = 'fresh' WHERE code = 'new'").run();
  db.prepare("INSERT INTO task_statuses(code, is_terminal) VALUES ('custom', 0)").run();
  const expected = db.prepare('SELECT * FROM task_statuses ORDER BY id').all();
  db.close();
  initializeDatabase(filename);
  db = openDatabase(filename);
  try {
    assert.deepEqual(db.prepare('SELECT * FROM task_statuses ORDER BY id').all(), expected);
    assert.equal(db.pragma('user_version', { simple: true }), 9);
    db.pragma('user_version = 10');
    assert.equal(db.pragma('journal_mode = DELETE', { simple: true }), 'delete');
  } finally { db.close(); }
  assert.throws(() => initializeDatabase(filename), /newer/);
  assert.throws(() => openDatabase(filename), /compatible/);
  const unsupported = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    assert.equal(unsupported.pragma('journal_mode', { simple: true }), 'delete');
    assert.equal(unsupported.pragma('user_version', { simple: true }), 10);
  } finally { unsupported.close(); }
});

test('schemas 6 and 7 upgrade a v0.7.0 database: work_chats dropped, requests renamed to tasks, journal literals mapped, ids and paths kept', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'v7.sqlite3');
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  for (const migration of ['001-initial.sql', '002-knowledge-journal.sql', '003-work-chats.sql',
    '004-work-chat-auth-pending.sql', '005-work-chat-process-origin.sql']) {
    db.exec(readFileSync(new URL('../../src/infrastructure/database/migrations/' + migration, import.meta.url), 'utf8'));
  }
  db.prepare("INSERT INTO organizations(slug) VALUES ('team')").run();
  db.prepare("INSERT INTO projects(org_id, slug, code) VALUES (1, 'tool', 'TT')").run();
  db.prepare("UPDATE request_statuses SET code = 'fresh' WHERE code = 'new'").run();
  db.prepare("INSERT INTO request_statuses(code, is_terminal) VALUES ('custom', 0)").run();
  const statuses = db.prepare('SELECT * FROM request_statuses ORDER BY id').all();
  const insertTask = db.prepare(`INSERT INTO requests(project_id, number, title, status_id, context_dir, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, 'now', 'now')`);
  for (let n = 1; n <= 49; n++) insertTask.run(1, n, 'Task ' + n, 'projects/team/tool/requests/TT-' + n + '-slug');
  insertTask.run(null, 1, 'Legacy', 'requests/REQ-1-legacy');
  db.prepare(`INSERT INTO work_chats (id, request_id, project_id, source_clone, worktree, git_common_dir, branch, installation, state_path, attempt_id, phase)
    VALUES ('chat', 1, 1, '/clone', '/task', '/git', 'task', '/engine', '/state', 'attempt', 'closed')`).run();
  type Row = { id: number; at: string; scopeType: string; scopeKey: string | null; eventType: string; text: string;
    artifactsJson: string | null; importPath: string | null; importLine: number | null };
  const scopes: [string, string | null][] = [['global', null], ['org', 'team'], ['project', 'TT'], ['request', 'TT-1'], ['request', 'REQ-1']];
  const artifacts = [null, '["projects/team/tool/requests/TT-1-slug/result.md"]', '["requests/REQ-1-legacy/result.md"]'];
  const seed: Row[] = [];
  const row = (scopeType: string, scopeKey: string | null, eventType: string, artifactsJson: string | null,
    importPath: string | null, importLine: number | null): Row => ({ id: seed.length + 1,
    at: '2026-01-01T00:00:' + String(seed.length % 60).padStart(2, '0') + '.000Z', scopeType, scopeKey, eventType,
    text: 'entry ' + (seed.length + 1), artifactsJson, importPath, importLine });
  seed.push(row('global', null, 'note', null, 'journal/2026-01.jsonl', 1));
  seed.push(row('global', null, 'note', null, 'journal/2026-01.jsonl', 2));
  for (let round = 0; round < 22; round++) {
    for (const [scopeType, scopeKey] of scopes) {
      for (const eventType of scopeType === 'request' ? ['note', 'request_created', 'status_changed'] : ['note']) {
        for (const artifactsJson of artifacts) seed.push(row(scopeType, scopeKey, eventType, artifactsJson, null, null));
      }
    }
  }
  const insertEntry = db.prepare(`INSERT INTO knowledge_journal(id, at, scope_type, scope_key, event_type, text, artifacts_json, import_path, import_line)
    VALUES (@id, @at, @scopeType, @scopeKey, @eventType, @text, @artifactsJson, @importPath, @importLine)`);
  db.transaction(() => { for (const entry of seed) insertEntry.run(entry); })();
  const insertFingerprint = db.prepare("INSERT INTO knowledge_file_fingerprints(path, sha256, byte_length, registered_at) VALUES (?, ?, 1, 'now')");
  for (const path of ['projects/team/tool/requests/TT-1-slug/source.md', 'projects/team/tool/requests/TT-1-slug/result.md',
    'requests/REQ-1-legacy/source.md', 'requests/REQ-1-legacy/result.md']) insertFingerprint.run(path, 'a'.repeat(64));
  const before = db.prepare('SELECT path FROM knowledge_file_fingerprints ORDER BY path').all();
  const dirs = db.prepare('SELECT id, context_dir FROM requests ORDER BY id').all();
  db.pragma('user_version = 5');
  db.close();
  assert.throws(() => openDatabase(filename, true), /compatible/);
  const started = performance.now();
  initializeDatabase(filename);
  t.diagnostic('migrations 006+007 on 50 tasks and ' + seed.length + ' journal rows: ' + Math.round(performance.now() - started) + ' ms');
  const upgraded = openDatabase(filename);
  try {
    assert.equal(upgraded.pragma('user_version', { simple: true }), 9);
    const names = (upgraded.prepare('SELECT name FROM sqlite_master').all() as { name: string }[]).map(x => x.name);
    for (const name of ['tasks', 'task_statuses', 'tasks_unassigned_number', 'used_status_terminality', 'used_project_code',
      'preserve_task_numbers', 'knowledge_journal', 'knowledge_journal_order']) assert.ok(names.includes(name), name);
    for (const name of ['requests', 'request_statuses', 'requests_unassigned_number', 'preserve_request_numbers', 'knowledge_journal_next']) {
      assert.ok(!names.includes(name), name);
    }
    assert.deepEqual(names.filter(name => name.startsWith('work_chats')), []);
    assert.deepEqual(upgraded.prepare('SELECT * FROM task_statuses ORDER BY id').all(), statuses);
    assert.deepEqual(upgraded.prepare('SELECT id, context_dir FROM tasks ORDER BY id').all(), dirs);
    assert.deepEqual(upgraded.prepare('SELECT path FROM knowledge_file_fingerprints ORDER BY path').all(), before);
    assert.deepEqual(upgraded.prepare('SELECT DISTINCT worktree_path FROM tasks').all(), [{ worktree_path: null }]);
    assert.deepEqual(upgraded.prepare(`SELECT id, at, scope_type AS scopeType, scope_key AS scopeKey, event_type AS eventType, text,
      artifacts_json AS artifactsJson, import_path AS importPath, import_line AS importLine FROM knowledge_journal ORDER BY id`).all(),
    seed.map(entry => ({ ...entry, scopeType: entry.scopeType === 'request' ? 'task' : entry.scopeType,
      eventType: entry.eventType === 'request_created' ? 'task_created' : entry.eventType })));
    const insertEvent = upgraded.prepare("INSERT INTO knowledge_journal(at, scope_type, scope_key, event_type, text) VALUES ('2026-02-01T00:00:00.000Z', ?, 'TT-1', ?, 'late')");
    assert.throws(() => insertEvent.run('request', 'note'), /CHECK/);
    assert.throws(() => insertEvent.run('task', 'request_created'), /CHECK/);
    insertEvent.run('task', 'task_created');
    assert.throws(() => upgraded.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, created_at, updated_at)
      VALUES (NULL, 1, 'Twin', 1, 'tasks/REQ-1-twin', 'now', 'now')`).run(), /UNIQUE/);
    assert.throws(() => upgraded.prepare('DELETE FROM tasks').run(), /cannot be deleted/);
    assert.throws(() => upgraded.prepare("UPDATE projects SET code = 'XX'").run(), /rename a project code with tasks/);
    assert.throws(() => upgraded.prepare('UPDATE task_statuses SET is_terminal = 1 WHERE id = 1').run(), /terminality/);
    assert.equal(upgraded.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(upgraded.pragma('foreign_key_check'), []);
  } finally { upgraded.close(); }
  await snapshotDatabase(filename, join(dir, 'snapshot.sqlite3'));
  assert.equal(existsSync(join(dir, 'snapshot.sqlite3')), true);
});

test('empty database initializes at schema 9 with the tasks, sessions and events tables', t => {
  const { filename } = state(t);
  const db = openDatabase(filename);
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 9);
    const names = (db.prepare('SELECT name FROM sqlite_master').all() as { name: string }[]).map(x => x.name);
    for (const name of ['tasks', 'task_statuses', 'tasks_unassigned_number', 'preserve_task_numbers', 'sessions', 'events']) assert.ok(names.includes(name), name);
    for (const name of ['requests', 'request_statuses', 'requests_unassigned_number', 'preserve_request_numbers']) assert.ok(!names.includes(name), name);
    assert.deepEqual(names.filter(name => name.startsWith('work_chats')), []);
    const event = db.prepare("INSERT INTO events(from_key, to_key, kind, message, created_at) VALUES ('MP-1', 'MP', ?, 'review', '2026-10-30T00:00:00.000Z')");
    event.run('milestone');
    assert.throws(() => event.run('other'), /CHECK/);
  } finally { db.close(); }
});

test('schema 9 upgrades a schema 8 database and keeps its events', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'v8.sqlite3');
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  for (const migration of ['001-initial.sql', '002-knowledge-journal.sql', '003-work-chats.sql',
    '004-work-chat-auth-pending.sql', '005-work-chat-process-origin.sql', '006-drop-work-chats.sql',
    '007-rename-requests-tasks.sql', '008-sessions-events.sql']) {
    db.exec(readFileSync(new URL('../../src/infrastructure/database/migrations/' + migration, import.meta.url), 'utf8'));
  }
  db.pragma('user_version = 8');
  const insert = db.prepare(`INSERT INTO events(id, from_key, to_key, kind, message, created_at, delivered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insert.run(3, 'MP-1', 'MP', 'turn_end', 'done', '2026-10-28T00:00:00.000Z', '2026-10-28T00:01:00.000Z');
  insert.run(7, 'MP-2', 'MP', 'waiting', '', '2026-10-29T00:00:00.000Z', null);
  const before = db.prepare('SELECT * FROM events ORDER BY id').all();
  db.close();
  initializeDatabase(filename);
  const upgraded = openDatabase(filename);
  try {
    assert.equal(upgraded.pragma('user_version', { simple: true }), 9);
    assert.deepEqual(upgraded.prepare('SELECT * FROM events ORDER BY id').all(), before);
    upgraded.prepare("INSERT INTO events(from_key, to_key, kind, message, created_at) VALUES ('MP-1', 'MP', 'milestone', 'review', '2026-10-30T00:00:00.000Z')").run();
    assert.equal(upgraded.pragma('integrity_check', { simple: true }), 'ok');
  } finally { upgraded.close(); }
});

test('sessions rows keep the scope shape, one native id per agent and the project code', t => {
  const { filename } = state(t);
  const app = createApp(filename, false);
  try {
    app.projects.add('one/project', 'MP');
    app.projects.add('two/other', 'OT');
  } finally { app.close(); }
  const db = openDatabase(filename);
  try {
    db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, created_at, updated_at)
      VALUES ((SELECT id FROM projects WHERE code = 'MP'), 1, 'First', (SELECT id FROM task_statuses WHERE code = 'new'),
      'projects/one/project/tasks/MP-1-first', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`).run();
    const p = (db.prepare("SELECT id FROM projects WHERE code = 'MP'").get() as { id: number }).id;
    const p2 = (db.prepare("SELECT id FROM projects WHERE code = 'OT'").get() as { id: number }).id;
    const task = (db.prepare('SELECT id FROM tasks WHERE project_id = ?').get(p) as { id: number }).id;
    const insert = db.prepare(`INSERT INTO sessions(key, scope_type, project_id, task_id, agent, native_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, '2026-10-28T00:00:00.000Z')`);
    insert.run('global', 'global', null, null, 'claude', 'c1');
    insert.run('MP', 'project', p, null, 'pi', 'p1');
    insert.run('MP-1', 'task', p, task, 'claude', 'c2');
    assert.throws(() => insert.run('other', 'global', null, null, 'claude', 'x1'), /CHECK|UNIQUE|FOREIGN/);
    assert.throws(() => insert.run('MP', 'project', null, null, 'claude', 'x2'), /CHECK|UNIQUE|FOREIGN/);
    assert.throws(() => insert.run('MP-2', 'task', p, null, 'claude', 'x3'), /CHECK|UNIQUE|FOREIGN/);
    assert.throws(() => insert.run('MP-3', 'task', p, task, 'codex', 'x4'), /CHECK|UNIQUE|FOREIGN/);
    assert.throws(() => insert.run('MP-4', 'task', p, task, 'claude', ''), /CHECK|UNIQUE|FOREIGN/);
    assert.throws(() => insert.run('MP-9', 'task', p, task, 'claude', 'c1'), /CHECK|UNIQUE|FOREIGN/);
    assert.throws(() => db.prepare("UPDATE projects SET code = 'MQ' WHERE id = ?").run(p), /Cannot rename a project code with tasks or sessions/);
    insert.run('OT', 'project', p2, null, 'pi', 'p2');
    assert.throws(() => db.prepare("UPDATE projects SET code = 'OU' WHERE id = ?").run(p2), /Cannot rename a project code with tasks or sessions/);
    db.prepare("DELETE FROM sessions WHERE key = 'OT'").run();
    db.prepare("UPDATE projects SET code = 'OU' WHERE id = ?").run(p2);
    const event = db.prepare("INSERT INTO events(from_key, to_key, kind, message, created_at) VALUES ('MP-1', 'MP', ?, 'done', '2026-10-28T00:00:00.000Z')");
    event.run('turn_end');
    assert.throws(() => event.run('busy'), /CHECK/);
  } finally { db.close(); }
});
