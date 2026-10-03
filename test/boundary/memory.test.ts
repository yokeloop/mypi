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
    const scoped = JSON.stringify(app.warmup('one/project'));
    assert(scoped.includes('global fact')); assert(scoped.includes('org fact')); assert(scoped.includes('project fact'));
    assert(!scoped.includes('foreign secret')); assert(!scoped.includes('draft')); assert(!scoped.includes('inbox'));
    assert(JSON.stringify(app.warmup()).includes(capture));
    assert.deepEqual(readFileSync(filename), before);
    assert.equal(app.memory.remove(1), 'global fact\nline');
    app.memory.add('keep');
    writeFileSync(join(root, 'MEMORY.md'), '# Memory\n\n- "uncommitted preimage"\n');
    assert.throws(() => app.memory.remove(1), /uncommitted/);
    assert(app.read('MEMORY.md')?.includes('uncommitted preimage'));
    assert.throws(() => app.capture('\ud800'), /Invalid Unicode/);
    assert.equal(readdirSync(join(root, 'inbox')).length, 1);
  } finally { app.close(); }
});
