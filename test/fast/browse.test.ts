process.env.TZ = 'UTC';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { InputError } from '../../src/shared/errors.js';
import { matchesQuery, pageLimit, takePage } from '../../src/shared/page.js';
import { pageTasks } from '../../src/modules/tasks/public.js';
import { createJournalBrowser, sqliteJournalStore } from '../../src/modules/knowledge/public.js';
import { sameScope } from '../../src/shared/scope.js';

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

const at = '2026-10-28T14:02:00.000Z';

function eventFixture(t: TestContext) {
  const { filename } = state(t);
  const app = createApp(filename, false);
  try {
    app.projects.add('one/project', 'MP');
    app.projects.add('two/other', 'OT');
  } finally { app.close(); }
  const tasks: [string, number, string][] = [['MP', 7, 'started'], ['MP', 12, 'scoped-warmup'], ['OT', 3, 'other']];
  const identities: Record<string, string> = { MP: 'one/project', OT: 'two/other' };
  const db = openDatabase(filename);
  try {
    for (const [code, number, slug] of tasks) {
      db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, worktree_path, created_at, updated_at)
        VALUES ((SELECT id FROM projects WHERE code = ?), ?, ?, (SELECT id FROM task_statuses WHERE code = 'new'), ?, NULL,
        '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`).run(code, number, slug,
        'projects/' + identities[code] + '/tasks/' + code + '-' + number + '-' + slug);
    }
  } finally { db.close(); }
  const e = <T>(fn: (events: ReturnType<typeof createApp>['events']) => T, readonly = false): T => {
    const app = createApp(filename, readonly, () => at);
    try { return fn(app.events); } finally { app.close(); }
  };
  const rows = () => {
    const db = openDatabase(filename, true);
    try {
      return db.prepare(`SELECT id, from_key AS fromKey, to_key AS toKey, kind, message, created_at AS createdAt, delivered_at AS deliveredAt
        FROM events ORDER BY id`).all() as { id: number; deliveredAt: string | null }[];
    } finally { db.close(); }
  };
  return { e, rows };
}

test('event browse filters by to, from, kind and delivery, searches the text, pages by id and never marks delivered', t => {
  const { e, rows } = eventFixture(t);
  e(x => {
    x.emit({ from: 'MP-12', kind: 'turn_end', message: 'готово' });
    x.emit({ from: 'MP-7', kind: 'waiting', message: 'жду' });
    x.send({ from: 'global', to: 'MP', message: 'Поручение' });
    x.emit({ from: 'OT-3', kind: 'turn_end', message: 'готово' });
    x.deliver([1]);
  });
  const browse = (filter: Parameters<ReturnType<typeof createApp>['events']['browse']>[0]) => e(x => x.browse(filter), true);
  const ids = (filter: Parameters<typeof browse>[0]) => browse(filter).items.map(row => row.id);
  assert.deepEqual(ids({ to: 'MP', limit: 10 }), [3, 2, 1]);
  assert.deepEqual(ids({ from: 'global', limit: 10 }), [3]);
  assert.deepEqual(ids({ kind: 'turn_end', limit: 10 }), [4, 1]);
  assert.deepEqual(ids({ delivered: false, limit: 10 }), [4, 3, 2]);
  assert.deepEqual(ids({ delivered: true, limit: 10 }), [1]);
  assert.deepEqual(ids({ q: 'ГОТОВО', limit: 10 }), [4, 1]);
  const first = browse({ limit: 2 });
  assert.deepEqual([first.items.map(row => row.id), first.next], [[4, 3], 3]);
  const second = browse({ before: 3, limit: 2 });
  assert.deepEqual([second.items.map(row => row.id), second.next], [[2, 1], null]);
  assert.deepEqual(rows().filter(row => row.id > 1).map(row => row.deliveredAt), [null, null, null]);
});

test('journal browser pages by id newest first with scope, time, type and text filters', t => {
  const { filename } = state(t), db = openDatabase(filename), store = sqliteJournalStore(db);
  t.after(() => db.close());
  const entries = [
    { at: '2026-10-02T00:00:00Z', scope: { type: 'global' as const }, event_type: 'note' as const, text: 'первая' },
    { at: '2026-10-03T00:00:00Z', scope: { type: 'project' as const, key: 'MP' }, event_type: 'note' as const, text: 'Поиск один' },
    { at: '2026-10-04T00:00:00Z', scope: { type: 'task' as const, key: 'MP-1' }, event_type: 'task_created' as const, text: 'Task registered.' },
    { at: '2026-09-15T00:00:00Z', scope: { type: 'global' as const }, event_type: 'note' as const, text: 'вторая' },
    { at: '2026-10-05T00:00:00Z', scope: { type: 'project' as const, key: 'MP' }, event_type: 'note' as const, text: 'поиск два' },
  ];
  for (const entry of entries) store.append(entry);
  const browser = createJournalBrowser(store, () => {}, sameScope);
  const ids = (page: { items: { id: number }[] }) => page.items.map(x => x.id);
  const first = browser.page('all', { limit: 2 });
  assert.deepEqual([ids(first), first.next], [[5, 4], 4]);
  assert.deepEqual(ids(browser.page('all', { before: 4, limit: 10 })), [3, 2, 1]);
  assert.deepEqual(ids(browser.page('all', { q: 'поиск', limit: 10 })), [5, 2]);
  assert.deepEqual(ids(browser.page('all', { type: 'task_created', limit: 10 })), [3]);
  assert.deepEqual(ids(browser.page({ type: 'project', key: 'MP' }, { limit: 10 })), [5, 2]);
  assert.deepEqual(ids(browser.page('all', { from: '2026-10-01T00:00:00Z', to: '2026-10-31T23:59:59Z', limit: 10 })), [5, 3, 2, 1]);
  assert.equal(first.items[0]!.entry.text, 'поиск два');
  assert.throws(() => browser.page('all', { from: '2026-10-31T00:00:00Z', to: '2026-10-01T00:00:00Z', limit: 10 }), InputError);
});
