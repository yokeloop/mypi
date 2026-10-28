import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { state } from '../support/state.js';
import { createWorkspace, initializeWorkspace } from '../../src/app/create-workspace.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { legacyTask } from '../support/legacy-task.js';

test('memory, notes, errors and capture preserve originals, parent context and read-only behavior', t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  const app = createWorkspace(filename, false, root);
  try {
    app.projects.add('one/project', 'MP'); app.projects.add('two/project', 'YM');
    assert.deepEqual(app.memory.show('one/project').items, []);
    assert.equal(existsSync(join(root, 'projects')), false);
    app.memory.add('global fact\nline');
    app.memory.add('org fact', 'one');
    app.memory.add('project fact', 'one/project');
    app.memory.add('foreign secret', 'two/project');
    const capture = app.capture('  draft\r\nexact\n');
    assert.equal(app.read(capture), '  draft\r\nexact\n');
    const first = app.note('same', '  one\n', 'one/project');
    const second = app.note('same', 'two', 'one/project');
    assert.notEqual(first, second); assert.equal(app.read(first), '# same\n\n  one\n');
    app.error('one/project', 'error\ntrace');
    assert.throws(() => app.error('one', 'wrong'), /project scope/);
    app.journal({ type: 'project', key: 'MP' }, 'result');
    assert.equal(app.memory.remove(1, app.memory.show().revision), 'global fact\nline');
    app.memory.add('keep');
    writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- "uncommitted preimage"\n');
    assert.throws(() => app.memory.remove(1, app.memory.show().revision), /uncommitted/);
    assert(app.read('MEMORY.md')?.includes('uncommitted preimage'));
    assert.throws(() => app.capture('\ud800'), /Invalid Unicode/);
    assert.equal(readdirSync(join(root, 'inbox')).length, 1);
  } finally { app.close(); }
});

test('journal_read global excludes projectless task events and rejects corrupt artifact metadata', t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  let at = '2026-10-01T00:00:00Z';
  const app = createWorkspace(filename, false, root, () => at);
  try {
    app.projects.add('one/project', 'MP'); app.projects.add('one/sibling', 'MS'); app.projects.add('two/project', 'YM');
    app.statuses.addStatus('finished', true);
    app.tasks.create({ project: 'two/project', title: 'foreign', status: 'new', slug: 'foreign', source: 'x' });
    const global = legacyTask(filename, root, 1, 'global');
    const keys: string[] = [];
    for (let i = 0; i < 22; i++) keys.push(app.tasks.create({ project: 'one/project', title: '😀'.repeat(1001),
      status: 'new', slug: 'item-' + i, source: 'x' }).key);
    app.tasks.change(keys[0]!, { status: 'finished' }, 'done');
    for (let i = 0; i < 30; i++) {
      app.journal({ type: 'project', key: 'MP' }, 'event ' + i);
      app.journal({ type: 'project', key: 'YM' }, 'foreign event ' + i);
    }
    const fullText = 'duplicate\n' + 'あ'.repeat(1100);
    app.journal({ type: 'project', key: 'MP' }, fullText);
    app.journal({ type: 'project', key: 'MP' }, fullText);
    app.journal({ type: 'task', key: keys[1]! }, 'child task event');
    for (let i = 0; i < 12; i++) {
      app.journal({ type: 'global' }, 'global event ' + i);
      app.journal({ type: 'task', key: global.key }, 'projectless event ' + i);
    }
    app.journal({ type: 'project', key: 'MS' }, 'sibling event');
    at = '2026-09-30T23:59:59Z';
    app.journal({ type: 'project', key: 'MP' }, 'late insert older timestamp');
    assert.equal(app.history({ type: 'global' }).length, 12, 'journal_read global excludes projectless tasks');
    const db = openDatabase(filename);
    try { db.prepare("UPDATE knowledge_journal SET artifacts_json='not json' WHERE text='event 0'").run(); }
    finally { db.close(); }
    assert.throws(() => app.history({ type: 'project', key: 'MP' }), /JSON/);
  } finally { app.close(); }
});
