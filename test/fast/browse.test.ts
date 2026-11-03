import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError } from '../../src/shared/errors.js';
import { matchesQuery, pageLimit, takePage } from '../../src/shared/page.js';
import { pageTasks } from '../../src/modules/tasks/public.js';

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

test('pageTasks pages newest first by id, searches key and title case-insensitively and continues after the cursor', () => {
  const titles = ['first', 'Поиск второй', 'third', 'fourth поиск', 'fifth'];
  const cards = titles.map((title, index) => ({ id: index + 1, key: 'MP-' + (index + 1), title }));
  const ids = (page: { items: { id: number }[] }) => page.items.map(c => c.id);
  const first = pageTasks(cards, { limit: 2 });
  assert.deepEqual([ids(first), first.next], [[5, 4], 4]);
  const second = pageTasks(cards, { before: 4, limit: 2 });
  assert.deepEqual([ids(second), second.next], [[3, 2], 2]);
  const last = pageTasks(cards, { before: 2, limit: 2 });
  assert.deepEqual([ids(last), last.next], [[1], null]);
  assert.equal(pageTasks(cards, { q: 'поиск', limit: 10 }).items.length, 2);
  assert.deepEqual(ids(pageTasks(cards, { q: 'mp-3', limit: 10 })), [3]);
});
