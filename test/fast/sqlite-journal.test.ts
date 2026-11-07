import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { sqliteJournalStore } from '../../src/modules/knowledge/public.js';
import { state } from '../support/state.js';

const entry = (text: string) => ({ at: '2026-10-02T00:00:00Z', scope: { type: 'global' as const }, event_type: 'note' as const, text });

test('SQLite journal shares caller transaction and gives equal timestamps stable insertion order', t => {
  const { filename } = state(t), db = openDatabase(filename), journal = sqliteJournalStore(db);
  try {
    db.transaction(() => { journal.append(entry('first')); journal.append(entry('second')); }).immediate();
    assert.deepEqual([...journal.entries()].map(x => (x as { text: string }).text), ['first', 'second']);
    assert.throws(() => db.transaction(() => { journal.append(entry('rolled back')); throw new Error('abort'); }).immediate(), /abort/);
    assert.deepEqual([...journal.entries()].map(x => (x as { text: string }).text), ['first', 'second']);
  } finally { db.close(); }
});

test('legacy import primitives retain duplicate source rows, reject changed replay, and never bless a replacement fingerprint', t => {
  const { filename } = state(t), db = openDatabase(filename), journal = sqliteJournalStore(db);
  const digest = 'a'.repeat(64);
  try {
    db.transaction(() => {
      journal.importEntry('journal/2026-10.jsonl', 1, entry('same'));
      journal.importEntry('journal/2026-10.jsonl', 2, entry('same'));
      journal.recordJournalImport({ path: 'journal/2026-10.jsonl', sha256: digest, byteLength: 20, importedAt: entry('x').at });
      journal.saveFingerprint({ path: 'tasks/MP-1-first/result.md', sha256: digest, byteLength: 20, registeredAt: entry('x').at });
    }).immediate();
    assert.equal([...journal.entries()].length, 2);
    assert.throws(() => journal.importEntry('journal/2026-10.jsonl', 1, entry('duplicate replay')), /UNIQUE/);
    assert.doesNotThrow(() => journal.recordJournalImport({ path: 'journal/2026-10.jsonl', sha256: digest, byteLength: 20, importedAt: entry('x').at }));
    assert.throws(() => journal.recordJournalImport({ path: 'journal/2026-10.jsonl', sha256: 'b'.repeat(64), byteLength: 20, importedAt: entry('x').at }), /changed/);
    journal.saveFingerprint({ path: 'tasks/MP-1-first/result.md', sha256: 'b'.repeat(64), byteLength: 24, registeredAt: '2026-10-03T00:00:00Z' });
    assert.deepEqual(journal.fingerprint('tasks/MP-1-first/result.md'), { path: 'tasks/MP-1-first/result.md', sha256: digest, byteLength: 20, registeredAt: '2026-10-02T00:00:00Z' });
  } finally { db.close(); }
});

test('relocateFiles rewrites only exact directory prefixes in fingerprints and artifacts', t => {
  const { filename } = state(t), db = openDatabase(filename), journal = sqliteJournalStore(db), commit = 'c'.repeat(40);
  try {
    db.transaction(() => {
      journal.saveFingerprint({ path: 'requests/REQ-1-x/result.md', sha256: 'a'.repeat(64), byteLength: 20, registeredAt: entry('x').at });
      journal.saveFingerprint({ path: 'requests/REQ-1-xy/result.md', sha256: 'a'.repeat(64), byteLength: 20, registeredAt: entry('x').at });
      journal.append({ ...entry('with artifacts'), artifacts: ['requests/REQ-1-x/a.md', 'requests/REQ-1-xy/b.md', { path: 'requests/REQ-1-x/c.md', commit }] });
      journal.append(entry('plain'));
    }).immediate();
    assert.deepEqual(journal.relocateFiles('requests/REQ-1-x', 'tasks/REQ-1-x'), { fingerprints: 1, artifacts: 1 });
    assert.ok(journal.fingerprint('tasks/REQ-1-x/result.md'));
    assert.equal(journal.fingerprint('requests/REQ-1-x/result.md'), undefined);
    assert.ok(journal.fingerprint('requests/REQ-1-xy/result.md'));
    assert.deepEqual([...journal.entries()].map(x => (x as { artifacts?: string[] }).artifacts),
      [['tasks/REQ-1-x/a.md', 'requests/REQ-1-xy/b.md', { path: 'requests/REQ-1-x/c.md', commit }], undefined]);
    assert.deepEqual(journal.relocateFiles('requests/REQ-1-x', 'tasks/REQ-1-x'), { fingerprints: 0, artifacts: 0 });
  } finally { db.close(); }
});

test('stats counts the project and the named tasks only and last returns the newest rows of one scope, newest last', t => {
  const { filename } = state(t), db = openDatabase(filename), journal = sqliteJournalStore(db);
  const one = { type: 'task' as const, key: 'MP-1' };
  try {
    db.transaction(() => {
      journal.append({ at: '2026-10-30T10:00:00.000Z', scope: one, event_type: 'task_created', text: 'created' });
      journal.append({ at: '2026-10-30T11:00:00.000Z', scope: one, event_type: 'note', text: 'one' });
      journal.append({ at: '2026-10-30T11:00:00.000Z', scope: one, event_type: 'note', text: 'two' });
      journal.append({ at: '2026-10-29T09:00:00.000Z', scope: { type: 'task', key: 'MP-2' }, event_type: 'note', text: 'other task' });
      journal.append({ at: '2026-10-31T09:00:00.000Z', scope: { type: 'project', key: 'MP' }, event_type: 'note', text: 'release' });
      journal.append({ at: '2026-11-01T09:00:00.000Z', scope: { type: 'task', key: 'OT-1' }, event_type: 'note', text: 'foreign' });
      journal.append({ at: '2026-11-02T09:00:00.000Z', scope: { type: 'global' }, event_type: 'note', text: 'global' });
    }).immediate();
    assert.deepEqual(journal.stats('MP', ['MP-1', 'MP-2']), { count: 5, lastAt: '2026-10-31T09:00:00.000Z' });
    assert.deepEqual(journal.stats('MP', []), { count: 1, lastAt: '2026-10-31T09:00:00.000Z' });
    assert.deepEqual(journal.stats('XX', ['XX-1']), { count: 0, lastAt: null });
    assert.deepEqual(journal.last(one, 2).map(e => e.text), ['one', 'two']);
    assert.deepEqual(journal.last(one, 10).map(e => e.text), ['created', 'one', 'two']);
    assert.deepEqual(journal.last({ type: 'global' }, 5).map(e => e.text), ['global']);
    assert.deepEqual(journal.last({ type: 'task', key: 'MP-9' }, 5), []);
  } finally { db.close(); }
});
