process.env.TZ = 'UTC';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { state } from '../support/state.js';
import { createApp } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { startMessage } from '../../src/app/start-message.js';
import type { Entry } from '../../src/modules/knowledge/public.js';

function fixture(t: TestContext) {
  const { dir, filename } = state(t);
  mkdirSync(join(dir, 'clone'));
  const app = createApp(filename, false);
  try {
    app.projects.add('one/project', 'MP', join(dir, 'clone'));
    app.projects.add('two/other', 'OT');
  } finally { app.close(); }
  const tasks: [string, number, string, string, string, string | null][] = [
    ['MP', 3, 'draft-api', 'Draft the API', 'new', null],
    ['MP', 4, 'other', 'Other', 'new', null],
    ['MP', 5, 'old-work', 'Old work', 'done', null],
    ['MP', 7, 'started', 'Started work', 'in_progress', join(dir, 'clone--MP-7-started')],
    ['MP', 12, 'scoped-warmup', 'Scoped warmup', 'planning', null],
    ['OT', 1, 'foreign', 'Foreign task', 'new', null],
  ];
  const identities: Record<string, string> = { MP: 'one/project', OT: 'two/other' };
  const db = openDatabase(filename);
  try {
    for (const [code, number, slug, title, status, worktree] of tasks) {
      db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, worktree_path, created_at, updated_at)
        VALUES ((SELECT id FROM projects WHERE code = ?), ?, ?, (SELECT id FROM task_statuses WHERE code = ?), ?, ?,
        '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`)
        .run(code, number, title, status, 'projects/' + identities[code] + '/tasks/' + code + '-' + number + '-' + slug, worktree);
    }
  } finally { db.close(); }
  const journal = (...entries: Entry[]) => {
    const app = createApp(filename, false);
    try { for (const entry of entries) app.journalStore.append(entry); } finally { app.close(); }
  };
  return { dir, filename, journal };
}

test('project start message groups open tasks by status and counts undelivered events without delivering them', t => {
  const { filename } = fixture(t);
  const app = createApp(filename, false);
  try {
    app.events.emit({ from: 'MP-7', kind: 'turn_end', message: 'one' });
    app.events.emit({ from: 'MP-12', kind: 'waiting', message: 'two' });
    app.events.milestone({ from: 'MP-3', message: 'new → review: ready' });
    app.events.emit({ from: 'OT-1', kind: 'turn_end', message: 'foreign' });
    app.events.deliver([1]);
  } finally { app.close(); }
  assert.equal(startMessage(filename, 'MP', null), 'Проект MP (one/project).\n\n'
    + 'Открытые задачи по статусам:\n'
    + 'new (2):\n- MP-3 Draft the API\n- MP-4 Other\n'
    + 'planning (1):\n- MP-12 Scoped warmup\n'
    + 'in_progress (1):\n- MP-7 Started work\n\n'
    + 'Недоставленных событий от задач на момент открытия: 2.\n\n'
    + 'Дождись указаний или предложи следующий шаг.');
  const read = createApp(filename, true);
  try { assert.deepEqual(read.events.pending('MP').map(e => e.id), [2, 3]); } finally { read.close(); }
  assert.equal(startMessage(filename, 'OT', null), 'Проект OT (two/other).\n\n'
    + 'Открытые задачи по статусам:\nnew (1):\n- OT-1 Foreign task\n\n'
    + 'Недоставленных событий от задач на момент открытия: 1.\n\n'
    + 'Дождись указаний или предложи следующий шаг.');
});

test('task start message shows status, worktree and the last five journal entries with their artifacts', t => {
  const { filename, journal } = fixture(t);
  const task = { type: 'task' as const, key: 'MP-12' };
  const folder = 'projects/one/project/tasks/MP-12-scoped-warmup/';
  const long = 'line one\nline two ' + 'y'.repeat(400);
  journal(
    { at: '2026-10-30T10:00:00.000Z', scope: task, event_type: 'task_created', text: 'Created' },
    { at: '2026-10-30T11:00:00.000Z', scope: task, event_type: 'note', text: 'first note' },
    { at: '2026-10-30T12:00:00.000Z', scope: task, event_type: 'status_changed', text: 'new → research' },
    { at: '2026-10-30T12:30:00.000Z', scope: { type: 'task', key: 'MP-7' }, event_type: 'note', text: 'foreign' },
    { at: '2026-10-30T13:00:00.000Z', scope: task, event_type: 'note', text: long },
    { at: '2026-10-30T13:30:00.000Z', scope: task, event_type: 'note', text: 'derive', artifacts: [folder + 'plan-v1.md', folder + 'derive.json'] },
    { at: '2026-10-30T14:04:00.000Z', scope: task, event_type: 'status_changed', text: 'research → planning. plan published',
      artifacts: [folder + 'plan-v2.md'] },
  );
  assert.equal(startMessage(filename, 'MP-12', '/abs/clone--MP-12-scoped-warmup'),
    'Задача MP-12 «Scoped warmup», статус planning.\n'
    + 'Worktree: /abs/clone--MP-12-scoped-warmup\n\n'
    + 'Последние записи журнала задачи:\n'
    + '- 2026-10-30 11:00 note: first note\n'
    + '- 2026-10-30 12:00 status_changed: new → research\n'
    + '- 2026-10-30 13:00 note: ' + long.replace('\n', ' ').slice(0, 300) + '…\n'
    + '- 2026-10-30 13:30 note: derive\n'
    + '  Артефакты: ' + folder + 'plan-v1.md, ' + folder + 'derive.json\n'
    + '- 2026-10-30 14:04 status_changed: research → planning. plan published\n'
    + '  Артефакты: ' + folder + 'plan-v2.md\n\n'
    + 'Дождись указаний или предложи следующий шаг.');
});

test('task start message without journal and without worktree says so', t => {
  const { dir, filename } = fixture(t);
  assert.equal(startMessage(filename, 'MP-3', null), 'Задача MP-3 «Draft the API», статус new.\n'
    + 'Worktree: не создан\n\n'
    + 'Записей в журнале задачи нет.\n\n'
    + 'Дождись указаний или предложи следующий шаг.');
  assert.ok(startMessage(filename, 'MP-7', null).startsWith('Задача MP-7 «Started work», статус in_progress.\n'
    + 'Worktree: ' + join(dir, 'clone--MP-7-started') + '\n'));
});
