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
      journal.saveFingerprint({ path: 'requests/REQ-1/result.md', sha256: digest, byteLength: 20, registeredAt: entry('x').at });
    }).immediate();
    assert.equal([...journal.entries()].length, 2);
    assert.throws(() => journal.importEntry('journal/2026-10.jsonl', 1, entry('duplicate replay')), /UNIQUE/);
    assert.doesNotThrow(() => journal.recordJournalImport({ path: 'journal/2026-10.jsonl', sha256: digest, byteLength: 20, importedAt: entry('x').at }));
    assert.throws(() => journal.recordJournalImport({ path: 'journal/2026-10.jsonl', sha256: 'b'.repeat(64), byteLength: 20, importedAt: entry('x').at }), /changed/);
    journal.saveFingerprint({ path: 'requests/REQ-1/result.md', sha256: 'b'.repeat(64), byteLength: 24, registeredAt: '2026-10-03T00:00:00Z' });
    assert.deepEqual(journal.fingerprint('requests/REQ-1/result.md'), { path: 'requests/REQ-1/result.md', sha256: digest, byteLength: 20, registeredAt: '2026-10-02T00:00:00Z' });
  } finally { db.close(); }
});
