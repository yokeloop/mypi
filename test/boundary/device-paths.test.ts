import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { TestContext } from 'node:test';
import type { AppCommand } from '../../src/app/commands.js';
import type { Backend } from '../../src/app/backend.js';
import { createApp } from '../../src/app/create-app.js';
import { deviceBackend, isDeviceBackend } from '../../src/app/device-paths.js';
import { executeCommand } from '../../src/app/execute-command.js';
import { runOperation } from '../../src/app/operations.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import { isRootRelativePath } from '../../src/infrastructure/filesystem/paths.js';
import { InputError } from '../../src/shared/errors.js';
import { state } from '../support/state.js';

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

function git(...args: string[]): void {
  const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
}

type Project = { org: string; slug: string; code: string; checkoutPath: string | null };

function engines(t: TestContext) {
  const { dir, filename } = state(t);
  const bare = join(dir, 'remote.git'), seed = join(dir, 'seed');
  git('init', '--bare', '--quiet', '--initial-branch=main', bare);
  git('init', '--quiet', '--initial-branch=main', seed);
  git('-C', seed, 'commit', '--quiet', '--allow-empty', '-m', 'seed');
  git('-C', seed, 'remote', 'add', 'origin', bare);
  git('-C', seed, 'push', '--quiet', 'origin', 'main');
  const engineA = join(dir, 'engine-a'), engineB = join(dir, 'engine-b');
  for (const engine of [engineA, engineB]) {
    mkdirSync(join(engine, 'projects', 'one'), { recursive: true });
    git('clone', '--quiet', bare, join(engine, 'projects', 'one', 'project'));
  }
  const server = { filename, trustedPaths: true };
  const inner = (device: string): Backend => ({ remote: true, device, run: async (n, i) => runOperation(server, n, i) });
  const a = deviceBackend(inner('a'), engineA), b = deviceBackend(inner('b'), engineB);
  const home = join(dir, 'home'), unused = join(dir, 'unused', 'state.sqlite3');
  const on = (backend: Backend) => (c: AppCommand) => executeCommand(c, unused, home, {}, {}, backend);
  const stored = () => (runOperation(server, 'project_list', {}) as { projects: Project[] }).projects;
  const cloneA = realpathSync(join(engineA, 'projects', 'one', 'project')), cloneB = realpathSync(join(engineB, 'projects', 'one', 'project'));
  return { dir, filename, bare, server, inner, a, b, runA: on(a), runB: on(b), stored, cloneA, cloneB, home, unused };
}

function task(filename: string, projectId: number, slug: string): void {
  const app = createApp(filename, false);
  try { app.tasks.create({ projectId, slug, title: slug, status: 'new' }, () => {}); } finally { app.close(); }
}

function journalCount(filename: string): number {
  const db = openDatabase(filename);
  try { return (db.prepare('SELECT count(*) AS n FROM knowledge_journal').get() as { n: number }).n; } finally { db.close(); }
}

test('two engine roots share one database through relative clone and worktree paths', async t => {
  const { filename, bare, runA, runB, stored, cloneA, cloneB } = engines(t);
  const added = await runA({ name: 'project_add', identity: 'one/project', code: 'MP', checkoutPath: cloneA, repository: bare }) as { project: { id: number; checkoutPath: string } };
  assert.equal(added.project.checkoutPath, cloneA);
  assert.equal(stored()[0]!.checkoutPath, 'projects/one/project');
  assert.equal(((await runA({ name: 'project_list' })) as { projects: Project[] }).projects[0]!.checkoutPath, cloneA);
  assert.equal(((await runB({ name: 'project_list' })) as { projects: Project[] }).projects[0]!.checkoutPath, cloneB);
  task(filename, added.project.id, 'x');
  const onA = await runA({ name: 'task_worktree', key: 'MP-1' }) as { worktreePath: string; created: boolean };
  assert.deepEqual([onA.worktreePath, onA.created], [cloneA + '--MP-1-x', true]);
  const card = () => (runOperation({ filename, trustedPaths: true }, 'task_show', { key: 'MP-1' }) as { worktreePath: string }).worktreePath;
  assert.equal(card(), 'projects/one/project--MP-1-x');
  const onB = await runB({ name: 'task_worktree', key: 'MP-1' }) as { worktreePath: string; created: boolean };
  assert.deepEqual([onB.worktreePath, onB.created], [cloneB + '--MP-1-x', true]);
  assert.equal(((await runB({ name: 'task_show', key: 'MP-1' })) as { worktreePath: string }).worktreePath, cloneB + '--MP-1-x');
  assert.equal(card(), 'projects/one/project--MP-1-x');
  mkdirSync(join(cloneB, 'src'));
  const resolved = await runB({ name: 'project_resolve', path: join(cloneB, 'src') }) as { match: string; code: string };
  assert.deepEqual([resolved.match, resolved.code], ['project', 'MP']);
  rmSync(cloneB + '--MP-1-x', { recursive: true, force: true });
  rmSync(cloneB, { recursive: true, force: true });
  await assert.rejects(runB({ name: 'task_worktree', key: 'MP-1' }), (error: unknown) => error instanceof InputError
    && error.message.startsWith('clone ' + cloneB + ' of one/project is not on this device; git clone ' + bare + ' ' + cloneB));
});

test('a clone outside the engine root is stored absolute', async t => {
  const { dir, bare, runA, runB, stored } = engines(t);
  mkdirSync(join(dir, 'outside'));
  const outside = realpathSync(join(dir, 'outside'));
  await runA({ name: 'project_add', identity: 'one/outside', code: 'OU', checkoutPath: join(dir, 'outside'), repository: bare });
  assert.equal(stored()[0]!.checkoutPath, outside);
  assert.equal(((await runB({ name: 'project_list' })) as { projects: Project[] }).projects[0]!.checkoutPath, outside);
});

test('project update with an absolute expected path passes on an old record and names the stored text when stale', async t => {
  const { bare, server, runA, stored, cloneA } = engines(t);
  runOperation(server, 'project_add', { identity: 'one/project', code: 'MP', checkoutPath: cloneA, repository: bare });
  assert.equal(stored()[0]!.checkoutPath, cloneA);
  const updated = await runA({ name: 'project_update', identity: 'one/project', expectedCheckoutPath: cloneA, checkoutPath: cloneA }) as { project: Project };
  assert.equal(updated.project.checkoutPath, cloneA);
  assert.equal(stored()[0]!.checkoutPath, 'projects/one/project');
  await assert.rejects(runA({ name: 'project_update', identity: 'one/project', expectedCheckoutPath: cloneA, checkoutPath: cloneA }),
    (error: unknown) => error instanceof InputError && error.message.startsWith('Stale project checkout path; stored "projects/one/project" (--expected-path'));
});

test('project resolve from a clone finds an old absolute record', async t => {
  const { bare, server, runA, cloneA } = engines(t);
  runOperation(server, 'project_add', { identity: 'one/project', code: 'MP', checkoutPath: cloneA, repository: bare });
  mkdirSync(join(cloneA, 'src'));
  const resolved = await runA({ name: 'project_resolve', path: join(cloneA, 'src') }) as { match: string; code: string };
  assert.deepEqual([resolved.match, resolved.code], ['project', 'MP']);
});

test('project relativize plans, rewrites only absolute paths under the root and repeats as a no-op', async t => {
  const { dir, filename, bare, server, inner, runA, stored, cloneA, home, unused } = engines(t);
  const second = realpathSync(join(dir, 'engine-a')) + '/projects/one/second';
  mkdirSync(join(dir, 'outside'));
  const outside = realpathSync(join(dir, 'outside'));
  const first = runOperation(server, 'project_add', { identity: 'one/project', code: 'MP', checkoutPath: cloneA, repository: bare }) as { project: { id: number } };
  runOperation(server, 'project_add', { identity: 'one/second', code: 'SE', checkoutPath: second, repository: bare });
  runOperation(server, 'project_add', { identity: 'one/outside', code: 'OU', checkoutPath: outside, repository: bare });
  task(filename, first.project.id, 'x');
  task(filename, first.project.id, 'y');
  runOperation(server, 'worktree_record', { key: 'MP-1', worktreePath: cloneA + '--MP-1-x' });
  runOperation(server, 'worktree_record', { key: 'MP-2', worktreePath: cloneA + '--MP-2-y' });
  const worktrees = () => (runOperation(server, 'task_list', {}) as { key: string; worktreePath: string | null }[]).map(c => c.worktreePath);
  const before = stored(), journal = journalCount(filename);
  const plan = await runA({ name: 'project_relativize', apply: false }) as { applied: boolean; projects: unknown[]; worktrees: unknown[] };
  assert.deepEqual(plan, { applied: false,
    projects: [{ identity: 'one/project', from: cloneA, to: 'projects/one/project' }, { identity: 'one/second', from: second, to: 'projects/one/second' }],
    worktrees: [{ key: 'MP-1', from: cloneA + '--MP-1-x', to: 'projects/one/project--MP-1-x' }, { key: 'MP-2', from: cloneA + '--MP-2-y', to: 'projects/one/project--MP-2-y' }] });
  assert.deepEqual(stored(), before);
  assert.deepEqual(worktrees(), [cloneA + '--MP-1-x', cloneA + '--MP-2-y']);
  const applied = await runA({ name: 'project_relativize', apply: true }) as { applied: boolean; projects: unknown[]; worktrees: unknown[] };
  assert.deepEqual(applied, { ...plan, applied: true });
  assert.deepEqual(stored().map(p => p.checkoutPath), [outside, 'projects/one/project', 'projects/one/second']);
  assert.deepEqual(worktrees(), ['projects/one/project--MP-1-x', 'projects/one/project--MP-2-y']);
  assert.equal(journalCount(filename), journal);
  assert.deepEqual(await runA({ name: 'project_relativize', apply: true }), { applied: true, projects: [], worktrees: [] });
  await assert.rejects(executeCommand({ name: 'project_relativize', apply: false }, unused, home, {}, {}, inner('a')),
    (error: unknown) => error instanceof InputError && error.message === 'project relativize runs only from the mypi CLI of a device');
});
