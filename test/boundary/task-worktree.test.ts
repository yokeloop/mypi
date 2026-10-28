import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { state } from '../support/state.js';
import { legacyTask } from '../support/legacy-task.js';
import { createApp } from '../../src/app/create-app.js';
import { run } from '../../src/cli/run.js';
import { parseCommand } from '../../src/cli/command.js';

function git(...args: string[]): string {
  const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function gitStatus(...args: string[]): number | null {
  return spawnSync('git', args, { encoding: 'utf8', timeout: 5000 }).status;
}

function push(seed: string, text: string): string {
  writeFileSync(join(seed, 'README.md'), text);
  git('-C', seed, 'commit', '--quiet', '-am', text);
  git('-C', seed, 'push', '--quiet', 'origin', 'main');
  return git('-C', seed, 'rev-parse', 'HEAD');
}

function fixture(t: TestContext, slugs: string[]) {
  const { dir, filename } = state(t);
  const bare = join(dir, 'remote.git'), seed = join(dir, 'seed'), clone = join(dir, 'projects', 'one', 'project');
  git('init', '--bare', '--quiet', '--initial-branch=main', bare);
  git('init', '--quiet', '--initial-branch=main', seed);
  writeFileSync(join(seed, 'README.md'), 'seed');
  git('-C', seed, 'add', 'README.md');
  git('-C', seed, 'commit', '--quiet', '-m', 'seed');
  git('-C', seed, 'remote', 'add', 'origin', bare);
  git('-C', seed, 'push', '--quiet', 'origin', 'main');
  mkdirSync(dirname(clone), { recursive: true });
  git('clone', '--quiet', bare, clone);
  const app = createApp(filename, false);
  try {
    const projectId = app.projects.add('one/project', 'MP', clone).id;
    app.projects.add('one/noclone', 'NC');
    for (const slug of slugs) app.tasks.create({ projectId, slug, title: slug, status: 'new' }, () => {});
  } finally { app.close(); }
  const base = realpathSync(clone);
  return { dir, filename, bare, seed, clone: base, expected: (key: string) => base + '--' + key };
}

function worktree(filename: string, key: string): Promise<unknown> {
  return run(parseCommand(['task', 'worktree', key]), filename);
}

function paths(filename: string): (string | null)[] {
  const app = createApp(filename, true);
  try { return app.tasks.list().map(card => card.worktreePath); } finally { app.close(); }
}

function untouched(clone: string, branch = 'main'): void {
  assert.equal(git('-C', clone, 'branch', '--show-current'), branch);
  assert.equal(git('-C', clone, 'status', '--porcelain'), '');
}

test('task worktree fast-forwards main, creates the branch beside the base clone, records the path and returns it again', async t => {
  const { filename, seed, clone, expected } = fixture(t, ['task-worktree']);
  const head = push(seed, 'two');
  const path = expected('MP-1-task-worktree');
  assert.deepEqual(await worktree(filename, 'MP-1'), { key: 'MP-1', branch: 'task/MP-1-task-worktree', worktreePath: path, created: true });
  assert.ok(existsSync(path));
  assert.equal(git('-C', path, 'branch', '--show-current'), 'task/MP-1-task-worktree');
  const list = git('-C', clone, 'worktree', 'list', '--porcelain');
  assert.match(list, new RegExp('worktree ' + path + '\\nHEAD [0-9a-f]+\\nbranch refs/heads/task/MP-1-task-worktree'));
  assert.deepEqual(paths(filename), [path]);
  assert.equal(git('-C', clone, 'rev-parse', 'main'), head);
  assert.equal(git('-C', clone, 'rev-parse', 'origin/main'), head);
  assert.equal(git('-C', path, 'rev-parse', 'HEAD'), head);
  untouched(clone);
  const count = (text: string) => text.split('\n').filter(line => line.startsWith('worktree ')).length;
  assert.deepEqual(await worktree(filename, 'MP-1'), { key: 'MP-1', branch: 'task/MP-1-task-worktree', worktreePath: path, created: false });
  assert.equal(count(git('-C', clone, 'worktree', 'list', '--porcelain')), count(list));

  git('-C', clone, 'switch', '--quiet', '-c', 'side');
  const app = createApp(filename, false);
  try { app.tasks.create({ projectId: app.projects.list().find(p => p.code === 'MP')!.id, slug: 'second', title: 'second', status: 'new' }, () => {}); }
  finally { app.close(); }
  const next = push(seed, 'three');
  const second = expected('MP-2-second');
  assert.deepEqual(await worktree(filename, 'MP-2'), { key: 'MP-2', branch: 'task/MP-2-second', worktreePath: second, created: true });
  assert.equal(git('-C', clone, 'rev-parse', 'main'), next);
  assert.equal(git('-C', second, 'rev-parse', 'HEAD'), next);
  untouched(clone, 'side');
  git('-C', clone, 'switch', '--quiet', 'main');
});

test('task worktree refuses unknown and projectless tasks, projects without a clone, an occupied branch and a foreign directory, recording nothing', async t => {
  const { dir, filename, clone, expected } = fixture(t, ['one', 'two', 'three']);
  const app = createApp(filename, false);
  try {
    const projectId = app.projects.list().find(p => p.code === 'NC')!.id;
    app.tasks.create({ projectId, slug: 'none', title: 'none', status: 'new' }, () => {});
  } finally { app.close(); }
  legacyTask(filename, join(dir, 'home'), 1, 'legacy');
  await assert.rejects(worktree(filename, 'MP-99'), /Unknown task: MP-99/);
  await assert.rejects(worktree(filename, 'REQ-1'), /Task REQ-1 has no project/);
  await assert.rejects(worktree(filename, 'NC-1'), /Project one\/noclone \(NC\) has no clone/);
  await assert.rejects(worktree(filename, 'mp-1'), /Invalid task key/);
  git('-C', clone, 'worktree', 'add', '--quiet', '-b', 'task/MP-1-one', join(dir, 'elsewhere'), 'main');
  await assert.rejects(worktree(filename, 'MP-1'), /is checked out in another worktree: .*elsewhere/);
  git('-C', clone, 'switch', '--quiet', '-c', 'task/MP-2-two');
  await assert.rejects(worktree(filename, 'MP-2'), new RegExp('is checked out in another worktree: ' + clone + ';'));
  git('-C', clone, 'switch', '--quiet', 'main');
  mkdirSync(expected('MP-3-three'));
  await assert.rejects(worktree(filename, 'MP-3'), /Worktree path exists and is not the worktree of task\/MP-3-/);
  assert.deepEqual(paths(filename), [null, null, null, null, null]);
  untouched(clone);
});

test('a main branch that cannot be updated refuses the worktree and records nothing', async t => {
  const { dir, filename, bare, seed, clone, expected } = fixture(t, ['blocked']);
  const absent = () => {
    assert.notEqual(gitStatus('-C', clone, 'rev-parse', '--verify', '--quiet', 'refs/heads/task/MP-1-blocked'), 0);
    assert.ok(!existsSync(expected('MP-1-blocked')));
    assert.deepEqual(paths(filename), [null]);
  };
  git('-C', clone, 'remote', 'set-url', 'origin', join(dir, 'missing.git'));
  await assert.rejects(worktree(filename, 'MP-1'), /Main branch cannot be updated in /);
  absent();
  git('-C', clone, 'remote', 'set-url', 'origin', bare);
  git('-C', clone, 'commit', '--quiet', '--allow-empty', '-m', 'local');
  const local = git('-C', clone, 'rev-parse', 'HEAD');
  push(seed, 'remote');
  await assert.rejects(worktree(filename, 'MP-1'), /Main branch cannot be updated in /);
  assert.equal(git('-C', clone, 'rev-parse', 'HEAD'), local);
  untouched(clone);
  absent();
});
