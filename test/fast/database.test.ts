import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeDatabase, openDatabase } from '../../src/infrastructure/database/database.js';
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

test('migration is repeatable without reseeding renamed/custom statuses; newer schema is rejected', t => {
  const { filename } = state(t);
  let db = openDatabase(filename);
  assert.deepEqual(db.prepare('SELECT code, is_terminal FROM request_statuses ORDER BY id').all(),
    ['new', 'research', 'planning', 'in_progress', 'review', 'blocked', 'paused', 'done', 'failed', 'cancelled']
      .map(code => ({ code, is_terminal: ['done', 'failed', 'cancelled'].includes(code) ? 1 : 0 })));
  db.prepare("UPDATE request_statuses SET code = 'fresh' WHERE code = 'new'").run();
  db.prepare("INSERT INTO request_statuses(code, is_terminal) VALUES ('custom', 0)").run();
  const expected = db.prepare('SELECT * FROM request_statuses ORDER BY id').all();
  db.close();
  initializeDatabase(filename);
  db = openDatabase(filename);
  try {
    assert.deepEqual(db.prepare('SELECT * FROM request_statuses ORDER BY id').all(), expected);
    db.pragma('user_version = 2');
  } finally { db.close(); }
  assert.throws(() => initializeDatabase(filename), /newer/);
  assert.throws(() => openDatabase(filename), /compatible/);
});
