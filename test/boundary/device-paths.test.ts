import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { Backend } from '../../src/app/backend.js';
import { deviceBackend, isDeviceBackend } from '../../src/app/device-paths.js';
import { isRootRelativePath } from '../../src/infrastructure/filesystem/paths.js';

function device(t: TestContext, fixtures: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-device-paths-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls: [string, unknown][] = [];
  const inner: Backend = { remote: true, device: 'laptop', run: async (name, input) => { calls.push([name, input]); return fixtures[name]; } };
  return { root: realpathSync(dir), calls, inner, backend: deviceBackend(inner, dir) };
}

test('a clone under the mypi root travels relative and comes back absolute', async t => {
  const { root, calls, inner, backend } = device(t, { project_add: { project: { code: 'AB', checkoutPath: 'projects/a/b' } } });
  assert.equal(isDeviceBackend(backend), true);
  assert.equal(isDeviceBackend(inner), false);
  assert.equal(backend.raw, inner);
  assert.equal(backend.root, root);
  assert.deepEqual([backend.remote, backend.device], [true, 'laptop']);
  const added = await backend.run('project_add', { identity: 'a/b', code: 'AB', checkoutPath: root + '/projects/a/b', repository: 'file:///x.git' });
  assert.deepEqual(calls, [['project_add', { identity: 'a/b', code: 'AB', checkoutPath: 'projects/a/b', repository: 'file:///x.git' }]]);
  assert.deepEqual(added, { project: { code: 'AB', checkoutPath: root + '/projects/a/b' } });
});

test('paths outside the projects folder travel and come back unchanged', async t => {
  const { root, calls, backend } = device(t, {});
  for (const path of ['/elsewhere/a', root + '/home/x']) {
    const { backend: echo } = device(t, { project_add: { project: { checkoutPath: path } } });
    assert.deepEqual(await echo.run('project_add', { identity: 'a/b', code: 'AB', checkoutPath: path, repository: 'file:///x.git' }),
      { project: { checkoutPath: path } });
    await backend.run('project_add', { identity: 'a/b', code: 'AB', checkoutPath: path, repository: 'file:///x.git' });
  }
  assert.deepEqual(calls.map(([, input]) => (input as { checkoutPath: string }).checkoutPath), ['/elsewhere/a', root + '/home/x']);
});

test('the expected path and the resolve path are never rewritten', async t => {
  const { root, calls, backend } = device(t, {});
  await backend.run('project_update', { identity: 'a/b', expectedCheckoutPath: root + '/projects/a/b', checkoutPath: root + '/projects/a/c' });
  await backend.run('project_resolve', { path: root + '/projects/a/b' });
  assert.deepEqual(calls, [
    ['project_update', { identity: 'a/b', expectedCheckoutPath: root + '/projects/a/b', checkoutPath: 'projects/a/c' }],
    ['project_resolve', { path: root + '/projects/a/b' }],
  ]);
});

test('worktree and opened session paths travel relative', async t => {
  const { root, calls, backend } = device(t, {});
  await backend.run('worktree_record', { key: 'MP-1', worktreePath: root + '/projects/a/b--MP-1-x' });
  await backend.run('checkout_record', { identity: 'a/b', checkoutPath: root + '/projects/a/b', action: 'cloned', repository: 'file:///x.git' });
  await backend.run('session_open', { agent: 'claude', nativeId: 'n', key: 'MP-1', device: 'laptop',
    opened: { action: 'started', worktree: root + '/projects/a/b--MP-1-x' } });
  assert.deepEqual(calls, [
    ['worktree_record', { key: 'MP-1', worktreePath: 'projects/a/b--MP-1-x' }],
    ['checkout_record', { identity: 'a/b', checkoutPath: 'projects/a/b', action: 'cloned', repository: 'file:///x.git' }],
    ['session_open', { agent: 'claude', nativeId: 'n', key: 'MP-1', device: 'laptop', opened: { action: 'started', worktree: 'projects/a/b--MP-1-x' } }],
  ]);
});

test('switched worktrees and listed cards come back absolute', async t => {
  const { root, backend } = device(t, {
    session_activate: { key: 'MP-1', switched: { key: 'MP-2', worktree: 'projects/a/b--MP-1-x' }, events: [] },
    task_list: { cards: [{ key: 'MP-1', worktreePath: 'projects/a/b--MP-1-x' }, { key: 'MP-2', worktreePath: '/old/a/b--MP-2-y' },
      { key: 'MP-3', worktreePath: null, title: 'projects/a/b' }] },
  });
  assert.deepEqual(await backend.run('session_activate', { agent: 'claude', nativeId: 'n', claim: false }),
    { key: 'MP-1', switched: { key: 'MP-2', worktree: root + '/projects/a/b--MP-1-x' }, events: [] });
  assert.deepEqual(await backend.run('task_list', {}), { cards: [{ key: 'MP-1', worktreePath: root + '/projects/a/b--MP-1-x' },
    { key: 'MP-2', worktreePath: '/old/a/b--MP-2-y' }, { key: 'MP-3', worktreePath: null, title: 'projects/a/b' }] });
});

test('only a clean path below projects/ is relative to the mypi root', () => {
  for (const path of ['projects/../x', 'projects/a/', 'projects', 'projects//x', 'projects/./x', '/projects/a', 'home/a', 'projects/a\0b']) {
    assert.equal(isRootRelativePath(path), false, path);
  }
  for (const path of ['projects/a', 'projects/a/b', 'projects/a/b--MP-1-x']) assert.equal(isRootRelativePath(path), true, path);
});
