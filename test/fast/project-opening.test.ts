import test from 'node:test';
import assert from 'node:assert/strict';
import { selectProjectOpening } from '../../src/app/project-opening.js';
import type { ProjectOpeningRegistry } from '../../src/app/project-opening.js';

const registry: ProjectOpeningRegistry = {
  projects: { list: () => [{ id: 1, org: 'one', slug: 'app', code: 'APP', checkoutPath: '/base' },
    { id: 2, org: 'one', slug: 'empty', code: 'EMP', checkoutPath: null }] },
  worktrees: () => [{ root: '/base' }, { root: '/task' }, { root: '/foreign' }],
  repositories: { verify: ({ project, worktreeRoot }) => {
    if (worktreeRoot === '/foreign') throw Error('foreign');
    return { project, baseRoot: '/base', commonDir: '/metadata', worktreeRoot, branch: worktreeRoot === '/base' ? 'main' : 'task/a', baseReadOnly: true };
  } },
};
test('project opening requires an exact registered project and Git-confirmed worktree', () => {
  const candidates = selectProjectOpening(registry);
  assert.deepEqual(candidates, { state: 'projects', projects: ['one/app', 'one/empty'],
    message: 'Select a registered project before inspecting its existing worktrees.' });
  const trees = selectProjectOpening(registry, 'one/app');
  if (trees.state === 'choices') assert.deepEqual(trees.choices.map(item => item.worktree), ['/base', '/task']);
  else assert.fail('Expected worktree choices');
  assert.deepEqual(selectProjectOpening({ ...registry, worktrees: () => { throw Error('unrelated repo'); } }), candidates);
  assert.throws(() => selectProjectOpening(registry, undefined, '/task'), /requires an explicit/);
  assert.deepEqual(selectProjectOpening(registry, 'one/app', '/task'),
    { state: 'selected', choice: { project: 'one/app', worktree: '/task', branch: 'task/a' } });
  assert.throws(() => selectProjectOpening(registry, 'one/app', '/foreign'), /not Git-confirmed/);
  assert.throws(() => selectProjectOpening(registry, 'one/empty', '/task'), /not Git-confirmed/);
  assert.throws(() => selectProjectOpening(registry, 'other/app'), /Unknown registered/);
  assert.equal(selectProjectOpening(registry, 'one/empty').state, 'choices');
});
