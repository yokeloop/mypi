import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { archivePath, createApp } from '../../src/app/create-app.js';
import { captureArchive } from '../../src/app/archive.js';
import { ARCHIVE_CHUNK_BYTES, runArchiveOperation } from '../../src/app/archive-operations.js';
import type { ArchiveOperationInput, ArchiveRunner } from '../../src/app/archive-operations.js';
import type { ArchiveHit } from '../../src/modules/archive/public.js';
import { openArchive } from '../../src/infrastructure/database/archive.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { InputError } from '../../src/shared/errors.js';

const jsonl = (records: object[]) => records.map(r => JSON.stringify(r) + '\n').join('');
const at = (minute: number) => '2026-11-07T10:' + String(minute).padStart(2, '0') + ':00.000Z';
const user = (uuid: string, parentUuid: string | null, minute: number, text = 'synthetic ' + uuid) =>
  ({ type: 'user', uuid, parentUuid, timestamp: at(minute), turnOrigin: 'human', message: { role: 'user', content: text } });
const assistant = (uuid: string, parentUuid: string | null, minute: number) =>
  ({ type: 'assistant', uuid, parentUuid, timestamp: at(minute), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'synthetic ' + uuid }] } });

function fakeRemote(filename: string, chunkBytes = ARCHIVE_CHUNK_BYTES): ArchiveRunner {
  return { remote: true, chunkBytes,
    run: async (n, i) => JSON.parse(JSON.stringify(runArchiveOperation({ filename }, n, JSON.parse(JSON.stringify(i))))) };
}

function recording(runner: ArchiveRunner) {
  const records: ArchiveOperationInput<'archive_record'>[] = [];
  const wrapped: ArchiveRunner = { ...runner, run: async (n, i) => {
    if (n === 'archive_record') records.push(JSON.parse(JSON.stringify(i)));
    return runner.run(n, i);
  } };
  return { runner: wrapped, records };
}

function rows(filename: string, nativeId: string) {
  const db = openArchive(archivePath(filename), true);
  try {
    return {
      ...db.prepare('SELECT count(*) AS rows, count(DISTINCT entry_id) AS entries FROM archive_messages WHERE native_id = ?').get(nativeId) as { rows: number; entries: number },
      bytesRead: (db.prepare('SELECT bytes_read AS bytesRead FROM archive_sessions WHERE native_id = ?').get(nativeId) as { bytesRead: number }).bytesRead,
      texts: (db.prepare('SELECT text FROM archive_messages WHERE native_id = ? ORDER BY id').all(nativeId) as { text: string }[]).map(r => r.text),
    };
  } finally { db.close(); }
}

function devices(dir: string) {
  const dev1 = join(dir, 'dev1'), dev2 = join(dir, 'dev2');
  mkdirSync(dev1);
  mkdirSync(dev2);
  return { dev1, dev2 };
}

test('capturing the same transcript twice gives one set of entries and the offset at the file size', async t => {
  const { dir, filename } = state(t);
  const { dev1 } = devices(dir);
  const file = join(dev1, 'c1.jsonl');
  writeFileSync(file, jsonl([user('u1', null, 1), assistant('a1', 'u1', 2)]));
  const runner = fakeRemote(filename);
  const capture = () => captureArchive(runner, { name: 'archive_capture', agent: 'claude', file, nativeId: 'c1' }) as Promise<{ inserted: number }>;
  assert.equal((await capture()).inserted, 2);
  assert.equal((await capture()).inserted, 0);
  let row = rows(filename, 'c1');
  assert.deepEqual([row.rows, row.entries, row.bytesRead], [2, 2, statSync(file).size]);
  appendFileSync(file, jsonl([user('u2', 'a1', 3), assistant('a2', 'u2', 4)]));
  assert.equal((await capture()).inserted, 2);
  row = rows(filename, 'c1');
  assert.deepEqual([row.rows, row.entries, row.bytesRead], [4, 4, statSync(file).size]);
});

test('a stale expectedOffset is refused with no rows and no offset change', async t => {
  const { dir, filename } = state(t);
  const { dev1 } = devices(dir);
  const file = join(dev1, 'c1.jsonl');
  writeFileSync(file, jsonl([user('u1', null, 1), assistant('a1', 'u1', 2)]));
  await captureArchive(fakeRemote(filename), { name: 'archive_capture', agent: 'claude', file, nativeId: 'c1' });
  const before = rows(filename, 'c1');
  assert.ok(before.bytesRead > 0);
  const e = { entryId: 'x1', parentEntryId: null, at: at(5), role: 'user' as const, origin: 'human' as const, text: 'synthetic x1' };
  assert.throws(() => runArchiveOperation({ filename }, 'archive_record', { agent: 'claude', nativeId: 'c1', path: file, expectedOffset: 0, newOffset: 999,
    read: { entries: [e], name: null, cwd: null, parentNativeId: null } }),
  (error: unknown) => error instanceof InputError && error.message === 'Archive offset of claude c1 changed: expected 0, found ' + before.bytesRead + '; capture again');
  const after = rows(filename, 'c1');
  assert.deepEqual([after.rows, after.bytesRead], [before.rows, before.bytesRead]);
});

test('sessions of one key on two devices are found by the key from either device', async t => {
  const { dir, filename } = state(t);
  const app = createApp(filename, false);
  try { app.projects.add('fx/one', 'FX', undefined, 'file:///nonexistent/fx/one.git'); } finally { app.close(); }
  const db = openDatabase(filename);
  try {
    db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, worktree_path, created_at, updated_at)
      VALUES ((SELECT id FROM projects WHERE code = 'FX'), 1, 'synthetic', (SELECT id FROM task_statuses WHERE code = 'new'),
      'projects/fx/one/tasks/FX-1-synthetic', NULL, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`).run();
    for (const [nativeId, device] of [['s1', 'dev1'], ['s2', 'dev2']] as const)
      db.prepare(`INSERT INTO sessions(key, scope_type, org_id, project_id, task_id, agent, native_id, device, created_at)
        VALUES ('FX-1', 'task', NULL, (SELECT id FROM projects WHERE code = 'FX'),
        (SELECT id FROM tasks WHERE number = 1 AND project_id = (SELECT id FROM projects WHERE code = 'FX')), 'claude', ?, ?, ?)`).run(nativeId, device, at(0));
  } finally { db.close(); }
  const { dev1, dev2 } = devices(dir);
  const one = fakeRemote(filename), two = fakeRemote(filename);
  writeFileSync(join(dev1, 's1.jsonl'), jsonl([user('u1', null, 1), assistant('a1', 'u1', 2)]));
  writeFileSync(join(dev2, 's2.jsonl'), jsonl([user('u2', null, 3), assistant('a2', 'u2', 4)]));
  await captureArchive(one, { name: 'archive_capture', agent: 'claude', file: join(dev1, 's1.jsonl') });
  await captureArchive(two, { name: 'archive_capture', agent: 'claude', file: join(dev2, 's2.jsonl') });
  for (const runner of [one, two]) {
    const { hits } = await runner.run('archive_search', { q: 'synthetic', scope: 'FX-1' }) as { hits: ArchiveHit[] };
    assert.deepEqual([...new Set(hits.map(h => h.session))].sort(), ['s1', 's2']);
    assert.ok(hits.every(h => h.key === 'FX-1'));
  }
});

test('the archive file appears on the first archive_record, not on archive_offset', t => {
  const { filename } = state(t);
  assert.deepEqual(runArchiveOperation({ filename }, 'archive_offset', { agent: 'claude', nativeId: 'missing' }), { offset: 0 });
  assert.equal(existsSync(archivePath(filename)), false);
  runArchiveOperation({ filename }, 'archive_record', { agent: 'claude', nativeId: 'c1', path: '/device/c1.jsonl', expectedOffset: 0, newOffset: 10,
    read: { entries: [], name: null, cwd: null, parentNativeId: null } });
  assert.equal(existsSync(archivePath(filename)), true);
  assert.deepEqual(runArchiveOperation({ filename }, 'archive_offset', { agent: 'claude', nativeId: 'c1' }), { offset: 10 });
});

test('a tail over the budget is sent in several records with one final offset', async t => {
  const { dir, filename } = state(t);
  const { dev1 } = devices(dir);
  const file = join(dev1, 'big.jsonl');
  writeFileSync(file, jsonl(Array.from({ length: 12 }, (_, i) => user('u' + i, i === 0 ? null : 'u' + (i - 1), i + 1, 'synthetic ' + String(i).repeat(1000)))));
  const { runner, records } = recording(fakeRemote(filename, 4096));
  await captureArchive(runner, { name: 'archive_capture', agent: 'claude', file });
  const size = statSync(file).size;
  assert.ok(records.length > 1);
  assert.ok(records.every(r => r.expectedOffset === 0));
  assert.deepEqual(records.map(r => r.newOffset), [...records.slice(1).map(() => 0), size]);
  const row = rows(filename, 'big');
  assert.deepEqual([row.rows, row.bytesRead], [12, size]);
});

test('an entry over the budget is truncated with a visible marker', async t => {
  const { dir, filename } = state(t);
  const { dev1 } = devices(dir);
  const file = join(dev1, 'huge.jsonl');
  const original = 'abcdefghij'.repeat(1000);
  writeFileSync(file, jsonl([user('u1', null, 1, original)]));
  const { runner, records } = recording(fakeRemote(filename, 4096));
  await captureArchive(runner, { name: 'archive_capture', agent: 'claude', file });
  const row = rows(filename, 'huge');
  assert.equal(row.texts.length, 1);
  const match = /^([\s\S]*)\n\[mypi: truncated (\d+) bytes\]$/.exec(row.texts[0]!);
  assert.ok(match);
  const k = match[1]!.length;
  assert.ok(k > 0);
  assert.equal(match[1], original.slice(0, k));
  assert.equal(Number(match[2]), original.length - k);
  for (const entry of records.flatMap(r => r.read.entries)) assert.ok(Buffer.byteLength(JSON.stringify(entry)) <= 4096);
  assert.equal(row.bytesRead, statSync(file).size);
});
