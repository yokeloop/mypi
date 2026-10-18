import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { state } from '../support/state.js';
import { createWorkspace, initializeWorkspace } from '../../src/app/create-workspace.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';

test('memory, notes, errors, capture and scoped warmup preserve originals, parent context and read-only behavior', t => {
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
    const before = readFileSync(filename);
    const warm = app.warmup('one/project');
    assert.deepEqual(Object.keys(warm).sort(), ['glossary', 'history', 'memory', 'work']);
    const scoped = JSON.stringify(warm);
    assert(scoped.includes('global fact')); assert(scoped.includes('org fact')); assert(scoped.includes('project fact'));
    assert(!scoped.includes('foreign secret')); assert(!scoped.includes('draft')); assert(!scoped.includes('inbox'));
    assert(JSON.stringify(app.warmup()).includes(capture));
    assert.deepEqual(readFileSync(filename), before);
    assert.equal(app.memory.remove(1, app.memory.show().revision), 'global fact\nline');
    app.memory.add('keep');
    writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- "uncommitted preimage"\n');
    assert.throws(() => app.memory.remove(1, app.memory.show().revision), /uncommitted/);
    assert(app.read('MEMORY.md')?.includes('uncommitted preimage'));
    assert.throws(() => app.capture('\ud800'), /Invalid Unicode/);
    assert.equal(readdirSync(join(root, 'inbox')).length, 1);
  } finally { app.close(); }
});

test('warmup indexes nonterminal scoped work after filtering, with bounded chronological events and no Git reads', t => {
  const { dir, filename } = state(t), root = join(dir, 'home');
  initializeWorkspace(filename, root);
  let at = '2026-10-01T00:00:00Z';
  const app = createWorkspace(filename, false, root, () => at);
  try {
    app.projects.add('one/project', 'MP'); app.projects.add('one/sibling', 'MS'); app.projects.add('two/project', 'YM');
    app.statuses.addStatus('finished', true);
    const foreign = app.requests.create({ project: 'two/project', title: 'foreign', status: 'new', slug: 'foreign', source: 'x' });
    const global = app.requests.create({ title: 'global', status: 'new', slug: 'global', source: 'x' });
    const keys: string[] = [];
    for (let i = 0; i < 22; i++) keys.push(app.requests.create({ project: 'one/project', title: '😀'.repeat(1001),
      status: 'new', slug: 'item-' + i, source: 'x' }).key);
    app.requests.change(keys[0]!, { status: 'finished' }, 'done');
    for (let i = 0; i < 30; i++) {
      app.journal({ type: 'project', key: 'MP' }, 'event ' + i);
      app.journal({ type: 'project', key: 'YM' }, 'foreign event ' + i);
    }
    const fullText = 'duplicate\n' + 'あ'.repeat(1100);
    app.journal({ type: 'project', key: 'MP' }, fullText);
    app.journal({ type: 'project', key: 'MP' }, fullText);
    app.journal({ type: 'request', key: keys[1]! }, 'child request event');
    for (let i = 0; i < 12; i++) {
      app.journal({ type: 'global' }, 'global event ' + i);
      app.journal({ type: 'request', key: global.key }, 'projectless event ' + i);
    }
    app.journal({ type: 'project', key: 'MS' }, 'sibling event');
    at = '2026-09-30T23:59:59Z';
    app.journal({ type: 'project', key: 'MP' }, 'late insert older timestamp');
    const original = readFileSync(filename);
    writeFileSync(join(root, '.git/index.lock'), 'no Git');
    const project = app.warmup('one/project');
    assert.equal(project.work.openTaskCount, 21);
    assert.equal(project.work.tasks.length, 20);
    assert.equal(project.work.tasks[0]!.key, keys[21]);
    assert.equal(project.work.tasks[0]!.title.text, '😀'.repeat(1000));
    assert.equal(project.work.tasks[0]!.title.truncated, true);
    assert.equal(project.work.events.length, 10);
    assert.equal(project.work.olderEvents, true);
    assert.equal(project.work.events.at(-1)!.text.text, 'child request event');
    assert.equal(project.work.events[0]!.text.text, 'event 23');
    assert.equal(project.work.events[0]!.read.at, '2026-10-01T00:00:00Z');
    assert.equal(app.history({ type: 'global' }).length, 12, 'journal_read global excludes projectless requests');
    assert(!JSON.stringify(project).includes('foreign'));
    const projectHistory = project.history;
    assert(projectHistory);
    assert.deepEqual(projectHistory.map(entry => entry.text),
      [...Array.from({ length: 7 }, (_, i) => 'event ' + (i + 23)), fullText, fullText, 'child request event']);
    assert.deepEqual(projectHistory.map(entry => entry.scope.type),
      [...Array(9).fill('project'), 'request']);
    assert.deepEqual(projectHistory.map(entry => entry.at), Array(10).fill('2026-10-01T00:00:00Z'));
    assert.equal(projectHistory[7]!.text, fullText, 'legacy history retains full Unicode text');
    assert.equal(project.work.events[7]!.text.truncated, true);
    assert.equal(project.work.events[7]!.text.text, Array.from(fullText).slice(0, 1000).join(''));
    assert.deepEqual(projectHistory[9], { at: '2026-10-01T00:00:00Z',
      scope: { type: 'request', key: keys[1] }, event_type: 'note', text: 'child request event' });
    const globalIndex = app.warmup().work;
    assert.deepEqual(globalIndex.tasks.map(task => task.key), [global.key]);
    assert(globalIndex.events.some(event => event.scope.type === 'request' && event.scope.key === global.key));
    assert(globalIndex.events.some(event => event.text.text === 'projectless event 11'));
    assert(!globalIndex.events.some(event => event.text.text === 'projectless event 0'));
    assert.equal(globalIndex.olderEvents, true);
    assert(!globalIndex.events.some(event => event.scope.type === 'project'));
    const org = app.warmup('one'), orgIndex = org.work;
    assert.equal(orgIndex.openTaskCount, 21);
    assert.equal(orgIndex.events.at(-1)!.text.text, 'sibling event');
    assert(!orgIndex.events.some(event => event.scope.type === 'global' || event.text.text.includes('foreign')));
    const orgHistory = org.history;
    assert(orgHistory);
    assert.deepEqual(orgHistory.map(entry => entry.text),
      [...Array.from({ length: 6 }, (_, i) => 'event ' + (i + 24)), fullText, fullText, 'child request event', 'sibling event']);
    assert.deepEqual(orgHistory.map(entry => entry.scope.type),
      [...Array(8).fill('project'), 'request', 'project']);
    assert(!globalIndex.events.some(event => event.scope.type === 'request' && event.scope.key === foreign.key));
    assert.equal(readFileSync(filename).equals(original), true);
    // An older row with unreadable metadata remains outside the last-eleven work window.
    // Legacy history scans/decode-all would fail this full warmup; journal_read stays strict.
    const db = openDatabase(filename);
    try { db.prepare("UPDATE knowledge_journal SET artifacts_json='not json' WHERE text='event 0'").run(); }
    finally { db.close(); }
    assert.deepEqual(app.warmup('one/project').history, projectHistory);
    assert.deepEqual(app.warmup('one').history, orgHistory);
    assert.throws(() => app.history({ type: 'project', key: 'MP' }), /JSON/);
  } finally { app.close(); }
});
