import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError } from '../../src/shared/errors.js';
import { matchesQuery, pageLimit, takePage } from '../../src/shared/page.js';

test('takePage keeps the limit, returns the last shown id as next and stops reading after limit+1', () => {
  assert.deepEqual(takePage([5, 4, 3], 2, x => x), { items: [5, 4], next: 4 });
  assert.deepEqual(takePage([5, 4], 2, x => x), { items: [5, 4], next: null });
  let yielded = 0;
  function* rows() { for (let id = 10; id > 0; id--) { yielded += 1; yield id; } }
  takePage(rows(), 2, x => x);
  assert.ok(yielded <= 3);
  for (const limit of [0, 201, 1.5]) assert.throws(() => pageLimit(limit), InputError);
  assert.equal(matchesQuery('ЗаДа', 'задача'), true);
  assert.equal(matchesQuery('x', null), false);
  assert.equal(matchesQuery(undefined), true);
});
