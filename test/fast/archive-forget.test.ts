import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { archivePath, createApp, createArchiveApp } from '../../src/app/create-app.js';
import { archiveStatus, forgetArchive, importArchive, searchArchive } from '../../src/app/archive.js';
import { forgetFilter } from '../../src/modules/archive/public.js';
import type { ArchiveEntry, ArchiveHit, ArchiveRead } from '../../src/modules/archive/public.js';
import { openArchive } from '../../src/infrastructure/database/archive.js';
import { InputError } from '../../src/shared/errors.js';
import { parseCommand } from '../../src/cli/command.js';
import { appCommand } from '../../src/cli/app-command.js';

function entry(entryId: string, minute: number, text: string): ArchiveEntry {
  return { entryId, parentEntryId: null, at: '2026-11-07T10:' + String(minute).padStart(2, '0') + ':00.000Z', role: 'user', origin: 'human', text };
}

function read(entries: ArchiveEntry[], offset: number, extra: Partial<ArchiveRead> = {}): ArchiveRead {
  return { entries, offset, name: null, cwd: null, parentNativeId: null, ...extra };
}

const jsonl = (records: object[]) => records.map(r => JSON.stringify(r) + '\n').join('');
const at = (minute: number) => '2026-11-07T10:' + String(minute).padStart(2, '0') + ':00.000Z';
const user = (uuid: string, parentUuid: string | null, minute: number) =>
  ({ type: 'user', uuid, parentUuid, timestamp: at(minute), turnOrigin: 'human', message: { role: 'user', content: 'synthetic ' + uuid } });
const assistant = (uuid: string, parentUuid: string | null, minute: number) =>
  ({ type: 'assistant', uuid, parentUuid, timestamp: at(minute), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'synthetic ' + uuid }] } });
const forget = (filename: string, input: { session?: string; key?: string; before?: string }) =>
  forgetArchive(filename, { name: 'archive_forget', ...input });
const cli = (args: string[]) => {
  const parsed = parseCommand(args);
  if (parsed.type === 'help') throw new Error('Unexpected help');
  return appCommand(parsed, {});
};

function seeded(t: Parameters<typeof state>[0]) {
  const { dir, filename } = state(t);
  const setup = createApp(filename, false);
  try { setup.projects.add('one/project', 'MP'); } finally { setup.close(); }
  const { archive, close } = createArchiveApp(filename, false);
  try {
    archive.record({ agent: 'claude', nativeId: 'c1', path: '/synthetic/c1.jsonl', read: read([entry('e1', 0, 'synthetic alpha one'), entry('e2', 20, 'synthetic alpha two')], 10, { name: 'MP' }) });
    archive.record({ agent: 'claude', nativeId: 'c2', path: '/synthetic/c2.jsonl', read: read([entry('e3', 5, 'synthetic beta')], 10, { name: 'MP' }) });
    archive.record({ agent: 'pi', nativeId: 'p1', path: '/synthetic/p1.jsonl', read: read([entry('e4', 10, 'synthetic gamma')], 10) });
  } finally { close(); }
  return { dir, filename };
}

test('archive forget deletes the matching messages and reports sessions and messages', t => {
  const cases: [{ session?: string; key?: string; before?: string }, number, number][] = [
    [{ session: 'c2' }, 1, 1],
    [{ key: 'MP', before: '2026-11-07T10:10:00Z' }, 2, 2],
    [{ before: '2026-11-08' }, 3, 4],
  ];
  for (const [input, sessions, messages] of cases) {
    const { filename } = seeded(t);
    const before = archiveStatus(filename);
    assert.deepEqual(forget(filename, input), { archive: archivePath(filename), sessions, messages });
    const after = archiveStatus(filename);
    assert.equal(after.messages.claude + after.messages.pi, before.messages.claude + before.messages.pi - messages);
    assert.deepEqual(after.sessions, before.sessions);
  }
});

test('archive forget keeps the full-text index in step with the deleted messages', t => {
  const { filename } = seeded(t);
  assert.deepEqual(forget(filename, { session: 'c1' }), { archive: archivePath(filename), sessions: 1, messages: 2 });
  const db = openArchive(archivePath(filename));
  try {
    db.prepare("INSERT INTO archive_fts(archive_fts) VALUES('integrity-check')").run();
    const count = (word: string) => (db.prepare('SELECT count(*) AS n FROM archive_fts WHERE archive_fts MATCH ?').get('"' + word + '"') as { n: number }).n;
    assert.equal(count('alpha'), 0);
    assert.equal(count('beta'), 1);
  } finally { db.close(); }
  const hits = (q: string) => (searchArchive(filename, { name: 'archive_search', q }) as { hits: ArchiveHit[] }).hits;
  assert.deepEqual(hits('alpha'), []);
  assert.equal(hits('beta').length, 1);
});

test('archive forget without a match changes nothing', t => {
  const { filename } = seeded(t);
  const status = () => { const { bytes: _, ...rest } = archiveStatus(filename); return rest; };
  const before = status();
  for (const input of [{ key: 'MP-12' }, { key: 'M' }, { session: 'missing' }, { before: '2026-11-01' }, { session: 'p1', key: 'MP' }])
    assert.deepEqual(forget(filename, input), { archive: archivePath(filename), sessions: 0, messages: 0 }, JSON.stringify(input));
  assert.deepEqual(status(), before);
});

test('archive forget keeps the session row so a later import does not bring the text back', t => {
  const { dir, filename } = state(t);
  const folder = join(dir, 'claude');
  mkdirSync(folder);
  const file = join(folder, 'c3.jsonl');
  writeFileSync(file, jsonl([user('u1', null, 1), assistant('a1', 'u1', 2)]));
  const command = { name: 'archive_import' as const, home: dir, dirs: [{ agent: 'claude' as const, path: folder }] };
  assert.equal(importArchive(filename, command).inserted, 2);
  assert.equal(forget(filename, { session: 'c3' }).messages, 2);
  const rows = () => {
    const db = openArchive(archivePath(filename), true);
    try {
      return {
        session: db.prepare("SELECT bytes_read AS bytesRead FROM archive_sessions WHERE native_id = 'c3'").get() as { bytesRead: number } | undefined,
        messages: (db.prepare("SELECT entry_id AS entryId FROM archive_messages WHERE native_id = 'c3'").all() as { entryId: string }[]).map(r => r.entryId),
      };
    } finally { db.close(); }
  };
  assert.deepEqual(rows(), { session: { bytesRead: statSync(file).size }, messages: [] });
  assert.equal(importArchive(filename, command).inserted, 0);
  assert.deepEqual(rows().messages, []);
  appendFileSync(file, jsonl([user('u2', 'a1', 3)]));
  assert.equal(importArchive(filename, command).inserted, 1);
  assert.deepEqual(rows().messages, ['u2']);
});

test('archive forget needs a filter, checks its values and never creates the archive', t => {
  for (const input of [{}, { key: '' }, { before: 'yesterday' }, { session: 'a\u0001' }])
    assert.throws(() => forgetFilter(input), InputError, JSON.stringify(input));
  assert.deepEqual(forgetFilter({ session: 'c1', before: '2026-11-07' }), { nativeId: 'c1', before: '2026-11-07T00:00:00.000Z' });
  const { filename } = state(t);
  assert.deepEqual(forget(filename, { key: 'MP' }), { archive: archivePath(filename), sessions: 0, messages: 0 });
  assert.equal(existsSync(archivePath(filename)), false);
  assert.throws(() => forget(filename, {}), InputError);
  assert.deepEqual(cli(['archive', 'forget', '--key', 'MP', '--before', '2026-10-01']), { name: 'archive_forget', key: 'MP', before: '2026-10-01' });
  assert.deepEqual(cli(['archive', 'forget', '--session', 'c1']), { name: 'archive_forget', session: 'c1' });
});
