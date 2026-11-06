import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app/create-app.js';
import { state } from '../support/state.js';

test('a parent task belongs to the same project, is not the task itself and creates no cycle', t => {
  const { filename } = state(t);
  const app = createApp(filename, false);
  try {
    const first = app.projects.add('one/project', 'MP');
    const other = app.projects.add('two/project', 'YM');
    const create = (projectId: number, slug: string, parentId?: number, status = 'new') =>
      app.tasks.create({ projectId, slug, title: slug, status, ...(parentId === undefined ? {} : { parentId }) }, () => {});
    const a = create(first.id, 'a');
    const b = create(first.id, 'b', a.id);
    assert.equal(b.parentId, a.id);
    assert.equal(a.parentId, null);
    const foreign = create(other.id, 'foreign');
    assert.throws(() => create(first.id, 'stray', foreign.id), /same project/);
    const c = create(first.id, 'c');
    const set = app.tasks.setParent(c.id, b.id, 'epic');
    assert.equal(set.changed, true);
    assert.equal(set.after.parentId, b.id);
    assert.equal(app.tasks.setParent(c.id, b.id, 'again').changed, false);
    assert.throws(() => app.tasks.setParent(c.id, c.id, 'self'), /own parent/);
    assert.throws(() => app.tasks.setParent(a.id, c.id, 'loop'), /cycle/);
    assert.throws(() => app.tasks.setParent(c.id, foreign.id, 'foreign'), /same project/);
    assert.equal(app.tasks.setParent(c.id, null, 'detach').after.parentId, null);
    const done = create(first.id, 'done', undefined, 'done');
    assert.equal(app.tasks.setParent(done.id, a.id, 'late').after.parentId, a.id);
    assert.throws(() => app.tasks.setParent(c.id, a.id, ' '), /Nonempty/);
  } finally { app.close(); }
});
