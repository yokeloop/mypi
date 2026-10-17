import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../support/state.js';
import { initializeState } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { createJournal } from '../../src/modules/knowledge/public.js';
import { sameScope } from '../../src/shared/scope.js';
import { journalStorage } from '../../src/app/journal-storage.js';

test('SQLite journal preserves exact multiline and scope/filter before global limit', t => {
  const { filename } = state(t);
  initializeState(filename);
  const db = openDatabase(filename);
  t.after(() => db.close());
  let at = '2026-09-30T23:59:59Z';
  const journal = createJournal(journalStorage(db), scope => {
    if (scope.type !== 'global' && scope.key !== 'MP') throw new Error('Unknown scope');
  }, sameScope, () => at);
  journal.append(journal.record({ type: 'project', key: 'MP' }, ' сентябрь\r\nстрока'));
  at = '2026-10-01T00:00:00Z';
  journal.append(journal.record({ type: 'global' }, 'global'));
  at = '2026-10-02T00:00:00Z';
  journal.append(journal.record({ type: 'project', key: 'MP' }, 'октябрь'));
  assert.equal(journal.read({ type: 'project', key: 'MP' }).length, 2);
  assert.equal(journal.read({ type: 'project', key: 'MP' }, { limit: 1 })[0]?.text, 'октябрь');
  assert.equal(journal.read({ type: 'global' }).length, 1);
  assert.equal(journal.read('all', { to: '2026-09-30T23:59:59Z' })[0]?.text, ' сентябрь\r\nстрока');
  assert.throws(() => journal.record({ type: 'global', key: 'bad' } as never, 'bad'));
  assert.throws(() => journal.record({ type: 'project', key: 'YM' }, 'bad'), /Unknown/);
  assert.throws(() => journal.record({ type: 'global' }, 'bad', 'status_changed'));
  assert.equal(journal.read('all').length, 3);
});
