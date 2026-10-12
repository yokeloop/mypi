import test from 'node:test';
import assert from 'node:assert/strict';
import { selectOrganizationOpening, selectProjectOpening } from '../../src/app/project-opening.js';
import type { ProjectOpeningRegistry } from '../../src/app/project-opening.js';
import { createApp } from '../../src/app/create-app.js';
import { state } from '../support/state.js';
import Database from 'better-sqlite3';

const registry: ProjectOpeningRegistry = {
  projects: { listOrganizations: () => [{ id: 1, slug: 'one' }, { id: 2, slug: 'vacant' }], list: () => [{ id: 1, org: 'one', slug: 'app', code: 'APP', checkoutPath: '/base' },
    { id: 2, org: 'one', slug: 'empty', code: 'EMP', checkoutPath: null }] },
  worktrees: () => [{ root: '/base' }, { root: '/task' }, { root: '/foreign' }],
  repositories: { verify: ({ project, worktreeRoot }) => {
    if (worktreeRoot === '/foreign') throw Error('foreign');
    return { project, baseRoot: '/base', commonDir: '/metadata', worktreeRoot, branch: worktreeRoot === '/base' ? 'main' : 'task/a', baseReadOnly: true };
  } },
};
test('project opening requires an exact registered project and Git-confirmed worktree', () => {
  const candidates = selectProjectOpening(registry);
  assert.deepEqual(candidates, { state: 'projects', organizations: ['one', 'vacant'], projects: ['one/app', 'one/empty'],
    message: 'Select a registered organization or project.' });
  assert.deepEqual(selectOrganizationOpening(registry, 'vacant'), { state: 'organization', organization: 'vacant' });
  assert.throws(() => selectOrganizationOpening(registry, 'missing'), /Unknown registered organization/);
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

test('opening registry includes DB organizations with no projects', t => {
  const { filename } = state(t);
  const db = new Database(filename);
  db.prepare('INSERT INTO organizations(slug) VALUES (?)').run('vacant');
  db.close();
  const app = createApp(filename, true);
  t.after(() => app.close());
  assert.deepEqual(app.projects.listOrganizations().map(org => org.slug), ['vacant']);
  assert.deepEqual(app.projects.resolveScope('vacant').type, 'org');
});
