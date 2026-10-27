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
    const insert = db.prepare(`INSERT INTO requests(project_id, number, title, status_id, context_dir, created_at, updated_at)
      VALUES (?, ?, 'Title', ?, ?, '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z')`);
    const status = (db.prepare("SELECT id FROM request_statuses WHERE code = 'new'").get() as { id: number }).id;
    insert.run(p.id, 1, status, 'projects/one/project/requests/MP-1-first');
    insert.run(null, 1, status, 'requests/REQ-1-first');
    assert.throws(() => insert.run(null, 1, status, 'requests/REQ-1-duplicate'), /UNIQUE/);
    assert.throws(() => insert.run(p.id, 1, status, 'projects/one/project/requests/MP-1-other'), /UNIQUE/);
    assert.throws(() => insert.run(null, 2, status, 'requests/REQ-1-first'), /UNIQUE/);
    for (const bad of [0, -1, 1.5, 'bad']) assert.throws(() => insert.run(null, bad, status, 'requests/bad'));
    assert.throws(() => insert.run(999, 2, status, 'requests/bad'), /FOREIGN KEY/);
    assert.throws(() => insert.run(null, 2, 999, 'requests/bad'), /FOREIGN KEY/);
    assert.throws(() => insert.run(null, 2, null, 'requests/bad'), /NOT NULL/);
    assert.throws(() => db.prepare('DELETE FROM projects WHERE id = ?').run(p.id), /FOREIGN KEY/);
    assert.throws(() => db.prepare('DELETE FROM organizations').run(), /FOREIGN KEY/);
    assert.throws(() => db.prepare('DELETE FROM request_statuses WHERE id = ?').run(status), /FOREIGN KEY/);
    assert.throws(() => db.prepare('UPDATE request_statuses SET is_terminal = 1 WHERE id = ?').run(status), /terminality/);
    assert.throws(() => db.prepare("UPDATE projects SET code = 'YM' WHERE id = ?").run(p.id), /rename/);
    assert.throws(() => db.prepare('DELETE FROM requests').run(), /cannot be deleted/);
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
      assert.equal((reader.pragma('user_version', { simple: true }) as number), 6);
    } finally { reader.close(); }
  } finally { writer.close(); }
});

test('migration is repeatable without reseeding renamed/custom statuses; newer schema is rejected', t => {
  const { filename } = state(t);
  let db = openDatabase(filename);
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.deepEqual(db.prepare('SELECT code, is_terminal FROM request_statuses ORDER BY id').all(),
    ['new', 'research', 'planning', 'in_progress', 'review', 'blocked', 'paused', 'done', 'failed', 'cancelled']
      .map(code => ({ code, is_terminal: ['done', 'failed', 'cancelled'].includes(code) ? 1 : 0 })));
  db.prepare("UPDATE request_statuses SET code = 'fresh' WHERE code = 'new'").run();
  db.prepare("INSERT INTO request_statuses(code, is_terminal) VALUES ('custom', 0)").run();
  const expected = db.prepare('SELECT * FROM request_statuses ORDER BY id').all();
  db.exec('DROP TABLE knowledge_file_fingerprints; DROP TABLE knowledge_journal_imports; DROP TABLE knowledge_journal;');
  db.pragma('user_version = 1');
  assert.equal(db.pragma('journal_mode = DELETE', { simple: true }), 'delete');
  db.close();
  assert.throws(() => openDatabase(filename, true), /compatible/);
  // Failed ordinary opens cannot migrate or switch journal mode.
  initializeDatabase(filename);
  db = openDatabase(filename);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'work_chats%'").all(), []);
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  try {
    assert.deepEqual(db.prepare('SELECT * FROM request_statuses ORDER BY id').all(), expected);
    db.pragma('user_version = 7');
    assert.equal(db.pragma('journal_mode = DELETE', { simple: true }), 'delete');
  } finally { db.close(); }
  assert.throws(() => initializeDatabase(filename), /newer/);
  assert.throws(() => openDatabase(filename), /compatible/);
  const unsupported = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    assert.equal(unsupported.pragma('journal_mode', { simple: true }), 'delete');
    assert.equal(unsupported.pragma('user_version', { simple: true }), 7);
  } finally { unsupported.close(); }
});

test('schema 6 drops work_chats from a v0.7.0 database and keeps requests, integrity and backup', async t => {
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
  db.prepare(`INSERT INTO requests(project_id, number, title, status_id, context_dir, created_at, updated_at)
    VALUES (1, 1, 'Original', 1, 'original', 'now', 'now')`).run();
  db.prepare(`INSERT INTO work_chats (id, request_id, project_id, source_clone, worktree, git_common_dir, branch, installation, state_path, attempt_id, phase)
    VALUES ('chat', 1, 1, '/clone', '/task', '/git', 'task', '/engine', '/state', 'attempt', 'closed')`).run();
  db.pragma('user_version = 5');
  db.close();
  assert.throws(() => openDatabase(filename, true), /compatible/);
  initializeDatabase(filename);
  const upgraded = openDatabase(filename);
  try {
    assert.equal(upgraded.pragma('user_version', { simple: true }), 6);
    assert.deepEqual(upgraded.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'work_chats%'").all(), []);
    assert.deepEqual(upgraded.prepare('SELECT title FROM requests').all(), [{ title: 'Original' }]);
    assert.equal(upgraded.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(upgraded.pragma('foreign_key_check'), []);
  } finally { upgraded.close(); }
  await snapshotDatabase(filename, join(dir, 'snapshot.sqlite3'));
  assert.equal(existsSync(join(dir, 'snapshot.sqlite3')), true);
});

test('empty database initializes at schema 6 without work_chats', t => {
  const { filename } = state(t);
  const db = openDatabase(filename, true);
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 6);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'work_chats%'").all(), []);
  } finally { db.close(); }
});
