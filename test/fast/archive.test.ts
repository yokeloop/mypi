import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { archivePath, createApp, createArchiveApp } from '../../src/app/create-app.js';
import { bindKey } from '../../src/modules/archive/public.js';
import type { ArchiveEntry, ArchiveRead } from '../../src/modules/archive/public.js';
import { ARCHIVE_SCHEMA_VERSION, initializeArchive, openArchive } from '../../src/infrastructure/database/archive.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { InputError } from '../../src/shared/errors.js';

const at = '2026-11-07T00:00:00.000Z';

function entry(entryId: string, minute: number, role: ArchiveEntry['role'] = 'user', origin: ArchiveEntry['origin'] = 'human', text = 'synthetic ' + entryId): ArchiveEntry {
  return { entryId, parentEntryId: null, at: '2026-11-07T10:' + String(minute).padStart(2, '0') + ':00.000Z', role, origin, text };
}

function read(entries: ArchiveEntry[], offset: number, extra: Partial<ArchiveRead> = {}): ArchiveRead {
  return { entries, offset, name: null, cwd: null, parentNativeId: null, ...extra };
}

test('archive opens beside the state file with mode 0600 and its own user_version', t => {
  const { dir, filename } = state(t);
  assert.equal(existsSync(archivePath(filename)), false);
  createApp(filename, false).close();
  assert.equal(existsSync(archivePath(filename)), false);
  const app = createArchiveApp(filename, false, () => at);
  const path = app.path;
  app.close();
  assert.equal(path, join(realpathSync(dir), 'archive.sqlite3'));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const names = () => {
    const db = openArchive(path);
    try {
      assert.equal(db.pragma('user_version', { simple: true }), ARCHIVE_SCHEMA_VERSION);
      assert.equal(ARCHIVE_SCHEMA_VERSION, 1);
      assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
      return (db.prepare('SELECT name FROM sqlite_master ORDER BY name').all() as { name: string }[]).map(r => r.name);
    } finally { db.close(); }
  };
  const before = names();
  for (const name of ['archive_sessions', 'archive_messages', 'archive_messages_at', 'archive_fts',
    'archive_messages_ai', 'archive_messages_ad', 'archive_messages_au']) assert.ok(before.includes(name), name);
  const stateDb = openDatabase(filename, true);
  try { assert.equal(stateDb.pragma('user_version', { simple: true }), 15); } finally { stateDb.close(); }
  initializeArchive(path);
  assert.deepEqual(names(), before);
});

test('archive refuses a newer schema and never creates the file for reading', t => {
  const { filename } = state(t);
  const path = archivePath(filename);
  assert.throws(() => createArchiveApp(filename, true));
  assert.equal(existsSync(path), false);
  createArchiveApp(filename, false).close();
  const db = openArchive(path);
  try { db.pragma('user_version = 2'); } finally { db.close(); }
  assert.throws(() => initializeArchive(path), /newer/);
  assert.throws(() => openArchive(path, true), /does not match/);
});

test('recording the same read twice inserts nothing new and keeps the offset', t => {
  const { filename } = state(t);
  const app = createArchiveApp(filename, false, () => at);
  try {
    const { archive } = app;
    const input = (r: ArchiveRead) => ({ agent: 'claude' as const, nativeId: 'n1', path: '/transcripts/n1.jsonl', read: r });
    const first = read([entry('e1', 10), entry('e2', 11, 'assistant'), entry('e3', 12, 'user', 'peer')], 120, { cwd: '/work', parentNativeId: 'p1' });
    assert.deepEqual(archive.record(input(first)), { inserted: 3, skipped: 0, key: null, keySource: null, bytesRead: 120 });
    assert.equal(archive.offset('claude', 'n1'), 120);
    assert.equal(archive.offset('claude', 'missing'), 0);
    const again = archive.record(input(first));
    assert.equal(again.inserted, 0);
    assert.equal(again.skipped, 3);
    const count = () => {
      const db = openArchive(app.path, true);
      try { return (db.prepare('SELECT count(*) AS n FROM archive_messages').get() as { n: number }).n; } finally { db.close(); }
    };
    assert.equal(count(), 3);
    const next = archive.record(input(read([entry('e3', 12, 'user', 'peer'), entry('e4', 5)], 200)));
    assert.equal(next.inserted, 1);
    assert.equal(next.skipped, 1);
    assert.equal(next.bytesRead, 200);
    const row = archive.session('claude', 'n1')!;
    assert.equal(row.firstAt, '2026-11-07T10:05:00.000Z');
    assert.equal(row.lastAt, '2026-11-07T10:12:00.000Z');
    assert.equal(row.cwd, '/work');
    assert.equal(row.parentNativeId, 'p1');
    assert.equal(row.bytesRead, 200);
    assert.equal(row.updatedAt, at);
    assert.equal(archive.record(input(read([], 260))).bytesRead, 260);
    assert.equal(archive.offset('claude', 'n1'), 260);
    assert.equal(count(), 4);
    assert.throws(() => archive.record({ ...input(read([], 1)), nativeId: '' }), InputError);
    assert.throws(() => archive.record({ ...input(read([], 1)), path: '' }), InputError);
  } finally { app.close(); }
});

test('archive schema enforces checks, uniqueness and cascade', t => {
  const { filename } = state(t);
  const app = createArchiveApp(filename, false, () => at);
  const path = app.path;
  app.close();
  const db = openArchive(path);
  try {
    const session = db.prepare(`INSERT INTO archive_sessions(agent, native_id, path, key_source, updated_at) VALUES (?, ?, '/t', ?, ?)`);
    const message = db.prepare(`INSERT INTO archive_messages(agent, native_id, entry_id, at, role, origin, text) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    session.run('claude', 's1', null, at);
    assert.throws(() => message.run('claude', 's1', 'e0', at, 'user', 'human', ''), /CHECK/);
    assert.throws(() => message.run('claude', 's1', 'e0', at, 'system', 'human', 'x'), /CHECK/);
    assert.throws(() => message.run('claude', 's1', 'e0', at, 'user', 'tool', 'x'), /CHECK/);
    assert.throws(() => session.run('codex', 's2', null, at), /CHECK/);
    assert.throws(() => session.run('claude', 's2', 'guess', at), /CHECK/);
    assert.throws(() => message.run('pi', 'none', 'e0', at, 'user', 'human', 'x'), /FOREIGN KEY/);
    message.run('claude', 's1', 'e1', at, 'user', 'human', 'x');
    assert.throws(() => message.run('claude', 's1', 'e1', at, 'assistant', 'human', 'y'), /UNIQUE/);
    db.prepare(`DELETE FROM archive_sessions WHERE native_id = 's1'`).run();
    assert.equal((db.prepare('SELECT count(*) AS n FROM archive_messages').get() as { n: number }).n, 0);
  } finally { db.close(); }
});

test('full-text index follows inserts, updates and deletes', t => {
  const { filename } = state(t);
  const app = createArchiveApp(filename, false, () => at);
  try {
    app.archive.record({ agent: 'pi', nativeId: 'f1', path: '/t/f1.jsonl', read: read([entry('e1', 1, 'user', 'human', 'обсудили сокет событий')], 10) });
    const db = openArchive(app.path);
    try {
      const match = (query: string) => db.prepare('SELECT rowid FROM archive_fts WHERE archive_fts MATCH ?').all(query).length;
      assert.equal(match('сокет*'), 1);
      db.prepare(`UPDATE archive_messages SET text = 'другое'`).run();
      assert.equal(match('сокет*'), 0);
      assert.equal(match('другое'), 1);
      db.prepare('DELETE FROM archive_messages').run();
      assert.equal(match('другое'), 0);
      app.archive.record({ agent: 'pi', nativeId: 'f1', path: '/t/f1.jsonl', read: read([entry('e2', 2, 'user', 'human', 'сокет снова')], 20) });
      assert.equal(match('сокет*'), 1);
      db.prepare(`DELETE FROM archive_sessions WHERE native_id = 'f1'`).run();
      assert.equal(match('сокет*'), 0);
      assert.doesNotThrow(() => db.prepare(`INSERT INTO archive_fts(archive_fts) VALUES ('integrity-check')`).run());
    } finally { db.close(); }
  } finally { app.close(); }
});

test('key binding prefers the sessions row, then a registered name, else NULL', t => {
  const { filename } = state(t);
  const setup = createApp(filename, false);
  try { setup.projects.add('one/project', 'MP'); } finally { setup.close(); }
  const stateDb = openDatabase(filename);
  try {
    stateDb.prepare(`INSERT INTO sessions(key, scope_type, org_id, project_id, task_id, agent, native_id, created_at)
      VALUES ('global', 'global', NULL, NULL, NULL, 'claude', 'n1', ?)`).run(at);
  } finally { stateDb.close(); }
  const reader = createApp(filename, true);
  try {
    const keys = reader.archiveKeys;
    assert.deepEqual(bindKey('claude', 'n1', 'MP', keys), { key: 'global', keySource: 'sessions' });
    assert.deepEqual(bindKey('claude', 'n2', 'MP', keys), { key: 'MP', keySource: 'name' });
    assert.deepEqual(bindKey('claude', 'n2', 'one', keys), { key: 'one', keySource: 'name' });
    for (const name of ['XY', 'my-feature', 'all', 'MP-7', null]) assert.equal(bindKey('claude', 'n2', name, keys), null, String(name));
    assert.equal(bindKey('pi', 'n1', null, keys), null);
  } finally { reader.close(); }
  const app = createArchiveApp(filename, false, () => at);
  try {
    const record = (nativeId: string, name: string | null) =>
      app.archive.record({ agent: 'claude', nativeId, path: '/t/' + nativeId + '.jsonl', read: read([], 1, { name }) });
    const first = record('n1', null);
    assert.deepEqual([first.key, first.keySource], ['global', 'sessions']);
    assert.deepEqual([record('n2', 'MP').key, record('n2', null).keySource], ['MP', 'name']);
    const db = openDatabase(filename);
    try { db.prepare(`UPDATE sessions SET native_id = 'n2' WHERE key = 'global'`).run(); } finally { db.close(); }
    const rebound = record('n2', null);
    assert.deepEqual([rebound.key, rebound.keySource], ['global', 'sessions']);
    const kept = record('n1', null);
    assert.deepEqual([kept.key, kept.keySource], ['global', 'sessions']);
    const free = record('n4', null);
    assert.deepEqual([free.key, free.keySource], [null, null]);
  } finally { app.close(); }
});
