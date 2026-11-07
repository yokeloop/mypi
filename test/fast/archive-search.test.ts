import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveInstant, ftsQuery } from '../../src/modules/archive/public.js';
import { InputError } from '../../src/shared/errors.js';

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
