import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { state } from '../support/state.js';
import { createWorkspace, initializeWorkspace } from '../../src/app/create-workspace.js';

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
    app.projects.add('one/project', 'MP'); app.projects.add('two/project', 'YM');
    app.statuses.addStatus('finished', true);
    const foreign = app.requests.create({ project: 'two/project', title: 'foreign', status: 'new', slug: 'foreign', source: 'x' });
    const global = app.requests.create({ title: 'global', status: 'new', slug: 'global', source: 'x' });
    const keys: string[] = [];
    for (let i = 0; i < 21; i++) keys.push(app.requests.create({ project: 'one/project', title: '😀'.repeat(1001),
      status: 'new', slug: 'item-' + i, source: 'x' }).key);
    app.requests.change(keys[0]!, { status: 'finished' }, 'done');
    for (let i = 0; i < 11; i++) app.journal({ type: 'project', key: 'MP' }, 'event ' + i);
    const original = readFileSync(filename);
    writeFileSync(join(root, '.git/index.lock'), 'no Git');
    const project = app.warmup('one/project');
    assert.equal(project.work.openTaskCount, 20);
    assert.equal(project.work.tasks.length, 20);
    assert.equal(project.work.tasks[0]!.key, keys[20]);
    assert.equal(project.work.tasks[0]!.title.text, '😀'.repeat(1000));
    assert.equal(project.work.tasks[0]!.title.truncated, true);
    assert.equal(project.work.events.length, 10);
    assert.equal(project.work.olderEvents, true);
    assert.equal(project.work.events.at(-1)!.text.text, 'event 10');
    assert(!JSON.stringify(project).includes('foreign'));
    const globalIndex = app.warmup().work;
    assert.deepEqual(globalIndex.tasks.map(task => task.key), [global.key]);
    assert(globalIndex.events.some(event => event.scope.type === 'request' && event.scope.key === global.key));
    assert(!globalIndex.events.some(event => event.scope.type === 'request' && event.scope.key === foreign.key));
    assert.equal(readFileSync(filename).equals(original), true);
  } finally { app.close(); }
});
