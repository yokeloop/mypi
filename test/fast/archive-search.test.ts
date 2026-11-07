import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { existsSync } from 'node:fs';
import { state } from '../support/state.js';
import { archivePath, createApp, createArchiveApp } from '../../src/app/create-app.js';
import { archiveScope, searchArchive, showArchive } from '../../src/app/archive.js';
import { archiveInstant, ftsQuery } from '../../src/modules/archive/public.js';
import type { ArchiveAgent, ArchiveHit, ArchiveMessage, ArchiveOrigin, ArchiveRole, ArchiveSessionHits } from '../../src/modules/archive/public.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { InputError } from '../../src/shared/errors.js';

type Row = [at: string, role: ArchiveRole, origin: ArchiveOrigin, text: string];
type Window = { session: { agent: ArchiveAgent; session: string; key: string | null }; anchor: number; messages: ArchiveMessage[] };
type Page = { session: { agent: ArchiveAgent; key: string | null }; offset: number; total: number; next: number | null; messages: ArchiveMessage[] };

function fixture(t: TestContext) {
  const { filename } = state(t);
  const app = createApp(filename, false);
  try {
    app.projects.add('one/project', 'MP');
    app.projects.add('one/other', 'OT');
    app.projects.add('two/x', 'MPX');
  } finally { app.close(); }
  const db = openDatabase(filename);
  try {
    for (const [code, number, identity] of [['MP', 12, 'one/project'], ['MPX', 1, 'two/x']] as const) {
      db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, worktree_path, created_at, updated_at)
        VALUES ((SELECT id FROM projects WHERE code = ?), ?, ?, (SELECT id FROM task_statuses WHERE code = 'new'), ?, NULL,
        '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`).run(code, number, 'synthetic', 'projects/' + identity + '/tasks/' + code + '-' + number + '-synthetic');
    }
  } finally { db.close(); }
  const put = (agent: ArchiveAgent, nativeId: string, name: string | null, rows: Row[]) => {
    const { archive, close } = createArchiveApp(filename, false);
    try {
      archive.record({ agent, nativeId, path: '/synthetic/' + nativeId + '.jsonl', read: {
        entries: rows.map(([at, role, origin, text], i) => ({ entryId: nativeId + '-' + i, parentEntryId: null, at, role, origin, text })),
        offset: rows.length, name, cwd: null, parentNativeId: null } });
    } finally { close(); }
  };
  const search = (input: Omit<Parameters<typeof searchArchive>[1], 'name'>) => searchArchive(filename, { name: 'archive_search', ...input });
  const hits = (input: Omit<Parameters<typeof searchArchive>[1], 'name'>) => (search(input) as { hits: ArchiveHit[] }).hits;
  const sessions = (input: Omit<Parameters<typeof searchArchive>[1], 'name'>) => (search(input) as { sessions: ArchiveSessionHits[] }).sessions;
  const show = (input: Omit<Parameters<typeof showArchive>[1], 'name'>) => showArchive(filename, { name: 'archive_show', ...input });
  return { filename, put, search, hits, sessions, show };
}

test('archive search quotes every word, keeps a trailing star as a prefix and refuses a query without words', () => {
  assert.equal(ftsQuery('сокет-событий MP-12'), '"сокет-событий" "MP-12"');
  assert.equal(ftsQuery('реш* a AND'), '"реш"* "a" "AND"');
  assert.equal(ftsQuery('say "hi"'), '"say" """hi"""');
  assert.throws(() => ftsQuery(' * "" '), InputError);
  assert.throws(() => ftsQuery(''), InputError);
  assert.equal(archiveInstant('2026-10-01', false), '2026-10-01T00:00:00.000Z');
  assert.equal(archiveInstant('2026-10-31', true), '2026-10-31T23:59:59.999Z');
  assert.equal(archiveInstant('2026-10-01T10:00:00Z', false), '2026-10-01T10:00:00.000Z');
  assert.throws(() => archiveInstant('2026-13-01', false), InputError);
  assert.throws(() => archiveInstant('yesterday', false), InputError);
});

test('archive search ranks human turns and final answers with snippets and hides other origins unless asked', t => {
  const { put, hits } = fixture(t);
  put('claude', 'c-mp', 'MP', [
    ['2026-10-01T10:00:00.000Z', 'user', 'human', 'обсудили сокет событий'],
    ['2026-10-01T10:01:00.000Z', 'assistant', 'human', 'сокет событий оставили одним'],
    ['2026-10-01T10:02:00.000Z', 'user', 'peer', 'сокет от родителя'],
    ['2026-10-01T10:03:00.000Z', 'user', 'frame', 'сокет в рамке'],
  ]);
  const found = hits({ q: 'сокет*' });
  assert.equal(found.length, 2);
  assert.deepEqual(found.map(h => h.origin + '/' + h.role).sort(), ['human/assistant', 'human/user']);
  for (const hit of found) {
    assert.deepEqual(Object.keys(hit).sort(), ['agent', 'at', 'id', 'key', 'origin', 'role', 'session', 'snippet']);
    assert.equal(hit.key, 'MP');
    assert.equal(hit.agent, 'claude');
    assert.equal(hit.session, 'c-mp');
    assert.match(hit.snippet, /\[сокет/);
  }
  assert.equal(hits({ q: 'сокет*', includePeer: true }).length, 4);
  assert.deepEqual(hits({ q: 'MP-12' }), []);
  assert.deepEqual(hits({ q: 'a AND' }), []);
  assert.equal(hits({ q: 'сокет*', limit: 1 }).length, 1);
  assert.throws(() => hits({ q: 'сокет*', limit: 51 }), InputError);
});

test('archive search filters by scope with its tasks, by organization, agent and dates', t => {
  const { filename, put, hits } = fixture(t);
  const bound: [ArchiveAgent, string, string | null, string][] = [
    ['claude', 'c-mp', 'MP', '01'], ['claude', 'c-mp12', 'MP-12', '02'], ['claude', 'c-ot', 'OT', '03'], ['claude', 'c-mpx', 'MPX-1', '04'],
    ['claude', 'c-one', 'one', '05'], ['pi', 'p-global', 'global', '06'], ['pi', 'p-free', null, '07'],
  ];
  for (const [agent, nativeId, name, day] of bound) put(agent, nativeId, name, [['2026-10-' + day + 'T10:00:00.000Z', 'user', 'human', 'общее слово']]);
  const found = (input: Omit<Parameters<typeof searchArchive>[1], 'name' | 'q'>) => hits({ q: 'общее', ...input }).map(h => h.session).sort();
  assert.deepEqual(found({ scope: 'MP' }), ['c-mp', 'c-mp12']);
  assert.deepEqual(found({ scope: 'MP-12' }), ['c-mp12']);
  assert.deepEqual(found({ scope: 'one' }), ['c-mp', 'c-mp12', 'c-one', 'c-ot']);
  assert.deepEqual(found({ scope: 'global' }), ['p-global']);
  assert.deepEqual(found({}), ['c-mp', 'c-mp12', 'c-mpx', 'c-one', 'c-ot', 'p-free', 'p-global']);
  assert.deepEqual(found({ agent: 'pi' }), ['p-free', 'p-global']);
  assert.deepEqual(found({ from: '2026-10-02', to: '2026-10-02' }), ['c-mp12']);
  assert.deepEqual(archiveScope(filename, 'one'), { exact: ['one'], projects: ['OT', 'MP'] });
  for (const scope of ['XY', 'all', 'MP-99']) assert.throws(() => found({ scope }), (error: Error) => error instanceof InputError && /Unknown archive scope/.test(error.message));
  assert.throws(() => found({ agent: 'codex' as 'pi' }), InputError);
  assert.throws(() => found({ from: '2026-10-03', to: '2026-10-02' }), InputError);
});

test('archive search without a query lists sessions with their message counts', t => {
  const { put, sessions } = fixture(t);
  put('claude', 'c-mp', 'MP', [
    ['2026-10-01T10:00:00.000Z', 'user', 'human', 'начали'],
    ['2026-10-03T10:00:00.000Z', 'assistant', 'human', 'закончили'],
    ['2026-10-03T11:00:00.000Z', 'user', 'peer', 'родитель'],
  ]);
  put('claude', 'c-mp12', 'MP-12', [['2026-10-02T10:00:00.000Z', 'user', 'human', 'задача']]);
  put('claude', 'c-ot', 'OT', [['2026-10-04T10:00:00.000Z', 'user', 'human', 'чужое']]);
  assert.deepEqual(sessions({ scope: 'MP' }), [
    { agent: 'claude', session: 'c-mp', key: 'MP', firstAt: '2026-10-01T10:00:00.000Z', lastAt: '2026-10-03T10:00:00.000Z', messages: 2 },
    { agent: 'claude', session: 'c-mp12', key: 'MP-12', firstAt: '2026-10-02T10:00:00.000Z', lastAt: '2026-10-02T10:00:00.000Z', messages: 1 },
  ]);
  assert.equal(sessions({ scope: 'MP', includePeer: true })[0]!.messages, 3);
  assert.deepEqual(sessions({ scope: 'MP', from: '2026-10-02', to: '2026-10-02' }).map(s => [s.session, s.messages]), [['c-mp12', 1]]);
  assert.deepEqual(sessions({ scope: 'MP', from: '2026-10-01', to: '2026-10-01' }).map(s => [s.session, s.messages]), [['c-mp', 1]]);
});

test('archive show returns a window around a message and pages a session', t => {
  const { put, show } = fixture(t);
  put('claude', 'c-s', 'MP', [1, 2, 3, 4, 5, 6, 7].map(n =>
    ['2026-10-01T10:0' + n + ':00.000Z', n % 2 ? 'user' : 'assistant', n === 3 ? 'peer' : 'human', 'запись ' + n] as Row));
  const all = (show({ session: 'c-s', includePeer: true }) as Page).messages;
  assert.equal(all.length, 7);
  const id = (n: number) => all[n - 1]!.id;
  const texts = (messages: ArchiveMessage[]) => messages.map(m => m.text);
  const window = show({ id: id(4), before: 2, after: 2 }) as Window;
  assert.equal(window.anchor, id(4));
  assert.equal(window.session.key, 'MP');
  assert.deepEqual(texts(window.messages), ['запись 1', 'запись 2', 'запись 4', 'запись 5', 'запись 6']);
  assert.deepEqual(texts((show({ id: id(4), before: 2, after: 2, includePeer: true }) as Window).messages), ['запись 2', 'запись 3', 'запись 4', 'запись 5', 'запись 6']);
  assert.deepEqual(texts((show({ id: id(3), before: 2, after: 2 }) as Window).messages), ['запись 1', 'запись 2', 'запись 3', 'запись 4', 'запись 5']);
  const first = show({ session: 'c-s', limit: 3 }) as Page;
  assert.deepEqual([texts(first.messages), first.total, first.next], [['запись 1', 'запись 2', 'запись 4'], 6, 3]);
  const last = show({ session: 'c-s', offset: 3, limit: 3 }) as Page;
  assert.deepEqual([texts(last.messages), last.next], [['запись 5', 'запись 6', 'запись 7'], null]);
  put('claude', 'dup', null, [['2026-10-02T10:00:00.000Z', 'user', 'human', 'клод']]);
  put('pi', 'dup', null, [['2026-10-02T10:00:00.000Z', 'user', 'human', 'пи']]);
  assert.throws(() => show({ session: 'dup' }), (error: Error) => error instanceof InputError && /pass agent/.test(error.message));
  const pi = show({ session: 'dup', agent: 'pi' }) as Page;
  assert.deepEqual([pi.session.agent, texts(pi.messages)], ['pi', ['пи']]);
  for (const input of [{ id: id(1), session: 'c-s' }, {}, { id: id(1), offset: 1 }, { session: 'c-s', before: 1 }, { id: 999 }, { session: 'none' },
    { id: id(4), before: 21 }]) assert.throws(() => show(input), InputError);
});

test('archive search and show refuse a missing archive without creating it', t => {
  const { filename } = state(t);
  assert.throws(() => searchArchive(filename, { name: 'archive_search', q: 'x' }), /run mypi archive import/);
  assert.throws(() => showArchive(filename, { name: 'archive_show', id: 1 }), /run mypi archive import/);
  assert.equal(existsSync(archivePath(filename)), false);
});
