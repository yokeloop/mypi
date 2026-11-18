import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';
import { workspaceRecords } from '../../src/app/create-workspace.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import type { Scope } from '../../src/shared/scope.js';

type Row = { id: number; at: string; scope: Scope; type: 'note' | 'status_changed'; text: string };

test('journal reads of a large journal build one scope index per call', t => {
  const { filename } = state(t);
  const codes = Array.from({ length: 20 }, (_, j) => 'P' + String.fromCharCode(65 + j));
  const orgOfProject = new Map(codes.map((code, j) => [code, 'o' + (1 + Math.floor(j / 4))]));
  const taskKeys: string[] = [];
  const projectOfTask = new Map<string, string>();
  for (const code of codes) for (let n = 1; n <= 15; n++) { taskKeys.push(code + '-' + n); projectOfTask.set(code + '-' + n, code); }
  const rows: Row[] = [];
  for (let i = 0; i < 2400; i++) {
    const at = new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString().replace('.000Z', 'Z');
    if (i % 10 < 9) {
      rows.push({ id: i + 1, at, scope: { type: 'task', key: taskKeys[i % 300]! }, type: i % 3 === 0 ? 'status_changed' : 'note', text: 'e' + i });
    } else {
      const k = (i - 9) / 10;
      const scope: Scope = k % 3 === 0 ? { type: 'global' } : k % 3 === 1 ? { type: 'org', key: 'o' + (1 + k % 5) } : { type: 'project', key: codes[k % 20]! };
      rows.push({ id: i + 1, at, scope, type: 'note', text: 'e' + i });
    }
  }
  const db = openDatabase(filename);
  db.transaction(() => {
    const org = db.prepare('INSERT INTO organizations(slug) VALUES (?)');
    for (let o = 1; o <= 5; o++) org.run('o' + o);
    const project = db.prepare('INSERT INTO projects(org_id, slug, code) VALUES ((SELECT id FROM organizations WHERE slug = ?), ?, ?)');
    for (const code of codes) project.run(orgOfProject.get(code)!, 'p-' + code.toLowerCase(), code);
    const task = db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, created_at, updated_at)
      VALUES ((SELECT id FROM projects WHERE code = ?), ?, 'Title', (SELECT id FROM task_statuses ORDER BY id LIMIT 1), ?, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`);
    for (const key of taskKeys) {
      const code = projectOfTask.get(key)!;
      task.run(code, Number(key.slice(code.length + 1)), 'projects/' + orgOfProject.get(code) + '/p-' + code.toLowerCase() + '/tasks/' + key);
    }
    const entry = db.prepare('INSERT INTO knowledge_journal(at, scope_type, scope_key, event_type, text) VALUES (?, ?, ?, ?, ?)');
    for (const row of rows) entry.run(row.at, row.scope.type, row.scope.type === 'global' ? null : row.scope.key, row.type, row.text);
  })();
  db.close();

  const app = createApp(filename, false);
  t.after(() => app.close());
  const calls = { tasks: 0, projects: 0 };
  const count = (name: 'tasks' | 'projects') => { if (++calls[name] > 50) throw new Error('list called ' + calls[name] + ' times in one read'); };
  const tasksList = app.tasks.list, projectsList = app.projects.list;
  app.tasks.list = () => { count('tasks'); return tasksList(); };
  app.projects.list = (org?: string) => { count('projects'); return projectsList.call(app.projects, org); };
  const r = workspaceRecords(app, () => '2026-12-31T00:00:00Z');

  function inScope(filter: Scope | 'all', scope: Scope): boolean {
    if (filter === 'all') return true;
    if (filter.type === scope.type && (filter.type === 'global' || filter.key === (scope as { key: string }).key)) return true;
    if (scope.type === 'task') {
      const code = projectOfTask.get(scope.key)!;
      return (filter.type === 'project' && filter.key === code) || (filter.type === 'org' && filter.key === orgOfProject.get(code));
    }
    if (scope.type === 'project' && filter.type === 'org') return orgOfProject.get(scope.key) === filter.key;
    return false;
  }
  type Options = { from?: string; to?: string; type?: 'note' | 'status_changed'; limit?: number; before?: number };
  const matching = (filter: Scope | 'all', o: Options) => rows.filter(row => inScope(filter, row.scope) && (!o.type || row.type === o.type)
    && (!o.from || row.at >= o.from) && (!o.to || row.at <= o.to) && (o.before === undefined || row.id < o.before));
  function measured<T>(work: () => T): T {
    calls.tasks = 0; calls.projects = 0;
    const result = work();
    assert.ok(calls.tasks <= 2 && calls.projects <= 2, JSON.stringify(calls));
    return result;
  }
  function checkRead(filter: Scope | 'all', o: Options = {}) {
    const all = matching(filter, o).sort((a, b) => a.at.localeCompare(b.at)).map(row => row.text);
    const expected = o.limit === undefined ? all : all.slice(-o.limit);
    assert.deepEqual(measured(() => r.journal.read(filter, o)).map(e => e.text), expected);
  }
  function checkPage(filter: Scope | 'all', o: Options & { limit: number }) {
    const all = matching(filter, o).sort((a, b) => b.id - a.id);
    const items = all.slice(0, o.limit).map(row => row.id);
    const next = all.length > o.limit ? items[items.length - 1]! : null;
    const page = measured(() => r.browser.page(filter, o));
    assert.deepEqual([page.items.map(x => x.id), page.next], [items, next]);
    return page;
  }

  checkRead('all');
  checkRead('all', { limit: 25 });
  checkRead({ type: 'task', key: 'PA-1' });
  checkRead({ type: 'project', key: 'PA' });
  checkRead({ type: 'org', key: 'o1' });
  checkRead({ type: 'global' });
  checkRead({ type: 'org', key: 'o2' }, { from: '2026-10-15T00:00:00Z', to: '2026-11-15T23:59:59Z' });
  checkRead({ type: 'project', key: 'PB' }, { type: 'status_changed', limit: 10 });
  checkPage('all', { limit: 50 });
  const first = checkPage({ type: 'org', key: 'o3' }, { limit: 20 });
  assert.notEqual(first.next, null);
  checkPage({ type: 'org', key: 'o3' }, { limit: 20, before: first.next! });
  checkPage({ type: 'task', key: 'PC-2' }, { limit: 5 });
  checkPage({ type: 'project', key: 'PD' }, { type: 'status_changed', from: '2026-10-01T00:00:00Z', to: '2026-10-31T23:59:59Z', limit: 10 });
  assert.throws(() => r.journal.read({ type: 'task', key: 'PA-99' }), /Unknown task/);

  const unknown = openDatabase(filename);
  unknown.prepare("INSERT INTO knowledge_journal(at, scope_type, scope_key, event_type, text) VALUES ('2026-12-30T00:00:00Z', 'task', 'PA-99', 'note', 'stray')").run();
  unknown.close();
  assert.throws(() => r.journal.read('all'), /Unknown task/);
  assert.throws(() => r.browser.page('all', { limit: 200 }), /Unknown task/);
});
