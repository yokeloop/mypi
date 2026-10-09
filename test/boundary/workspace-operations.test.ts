import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../src/app/create-app.js';
import { executeWorkspaceOperation } from '../../src/app/workspace-operations.js';
import { executeCommand } from '../../src/app/execute-command.js';
import { PartialError } from '../../src/shared/context.js';
import { state } from '../support/state.js';

// Native Git is the oracle for exact-path commit/index preservation and remote ref state.
// One local cycle; no network, model, personal data or subprocess matrix.
test('workspace helpers preserve unrelated materials through prepare, exact commit and confirmed local publication', async t => {
  const { dir, filename } = state(t);
  const installed = join(dir, 'engine'), base = join(dir, 'base'), task = join(dir, 'task'), bare = join(dir, 'remote.git');
  function git(root: string, ...args: string[]) {
    const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
      '-c', 'commit.gpgsign=false', '-C', root, ...args], { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    return result.stdout;
  }
  for (const root of [installed, base]) {
    mkdirSync(root);
    git(root, 'init', '--quiet', '--initial-branch=main');
    git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@localhost');
    for (const name of ['changed.txt', 'deleted.txt', 'unrelated.txt', 'ambiguous.txt']) writeFileSync(join(root, name), 'original\n');
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
    git(root, 'add', '.gitignore', 'changed.txt', 'deleted.txt', 'unrelated.txt', 'ambiguous.txt');
    git(root, 'commit', '--quiet', '-m', 'fixture');
  }
  mkdirSync(bare); git(bare, 'init', '--quiet', '--bare');
  git(base, 'remote', 'add', 'origin', bare);
  const app = createApp(filename, false);
  app.projects.add('one/project', 'MP', installed); // Explicit base override, not checkout metadata, associates the independent repo.
  app.projects.add('two/project', 'FP', base);
  app.close();
  const selection = { project: 'one/project', baseRoot: base, worktreeRoot: task, branch: 'task/exact' };
  const prepare = { name: 'workspace_prepare' as const, ...selection, startPoint: 'refs/heads/main' };
  await assert.rejects(executeCommand({ ...prepare, project: 'two/project' }, filename, undefined,
    { scope: { kind: 'project', project: 'one/project' } }), /outside the working selection/);
  assert(!existsSync(task));
  writeFileSync(join(base, 'changed.txt'), 'dirty base remains\n');
  const baseHead = git(base, 'rev-parse', 'HEAD');
  const prepared = executeWorkspaceOperation(prepare, filename, installed);
  assert('status' in prepared && prepared.status === 'ok');
  assert.equal(git(base, 'symbolic-ref', '--short', 'HEAD').trim(), 'main');
  assert.equal(git(base, 'rev-parse', 'HEAD'), baseHead);
  assert.equal(readFileSync(join(base, 'changed.txt'), 'utf8'), 'dirty base remains\n');
  assert.equal(readFileSync(join(task, 'changed.txt'), 'utf8'), 'original\n');
  const inspect = () => executeWorkspaceOperation({ name: 'workspace_inspect', ...selection }, filename, installed);
  git(base, 'worktree', 'lock', task);
  const locked = inspect();
  assert('mutationUnavailable' in locked && locked.mutationUnavailable);
  assert('worktrees' in locked && locked.worktrees.some(tree => tree.root === task && tree.locked));
  git(base, 'worktree', 'unlock', task);
  writeFileSync(join(task, 'unrelated.txt'), 'staged unrelated\n'); git(task, 'add', 'unrelated.txt');
  writeFileSync(join(task, 'unrelated.txt'), 'working unrelated\n');
  writeFileSync(join(task, 'untracked.txt'), 'untracked bytes\n'); writeFileSync(join(task, 'ignored.txt'), 'ignored bytes\n');
  const unrelatedIndex = git(task, 'ls-files', '--stage', 'unrelated.txt');
  writeFileSync(join(task, 'ambiguous.txt'), 'staged preimage\n'); git(task, 'add', 'ambiguous.txt');
  writeFileSync(join(task, 'ambiguous.txt'), 'working version\n');
  const commit = { name: 'workspace_commit' as const, ...selection, paths: ['ambiguous.txt'], message: 'exact files' };
  const beforeRefusal = git(task, 'ls-files', '--stage');
  assert.throws(() => executeWorkspaceOperation(commit, filename, installed), /staged content differs/);
  assert.equal(git(task, 'ls-files', '--stage'), beforeRefusal);
  assert.equal(git(task, 'rev-parse', 'HEAD'), baseHead);
  assert.throws(() => executeWorkspaceOperation({ ...commit, paths: ['ignored.txt'] }, filename, installed), /Ignored or unavailable/);
  assert.equal(git(task, 'ls-files', '--stage'), beforeRefusal);
  writeFileSync(join(task, 'changed.txt'), 'changed\n'); rmSync(join(task, 'deleted.txt'));
  git(task, 'add', 'deleted.txt'); // A declared already-staged deletion must work too.
  writeFileSync(join(task, 'literal[1].txt'), 'literal new file\n');
  writeFileSync(join(task, 'literal1.txt'), 'not a pathspec match\n');
  const result = executeWorkspaceOperation({ ...commit, paths: ['changed.txt', 'deleted.txt', 'literal[1].txt'] }, filename, installed);
  assert('changed' in result && result.changed);
  const head = git(task, 'rev-parse', 'HEAD').trim();
  assert.deepEqual(git(task, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').trim().split('\n'),
    ['changed.txt', 'deleted.txt', 'literal[1].txt']);
  assert.equal(git(task, 'show', 'HEAD:changed.txt'), 'changed\n');
  assert.equal(git(task, 'show', 'HEAD:literal[1].txt'), 'literal new file\n');
  assert.equal(git(task, 'ls-files', '--stage', 'unrelated.txt'), unrelatedIndex);
  for (const [name, text] of [['unrelated.txt', 'working unrelated\n'], ['untracked.txt', 'untracked bytes\n'],
    ['ignored.txt', 'ignored bytes\n'], ['literal1.txt', 'not a pathspec match\n'], ['ambiguous.txt', 'working version\n']]) {
    assert.equal(readFileSync(join(task, name!), 'utf8'), text);
  }
  const noop = executeWorkspaceOperation({ ...commit, paths: ['changed.txt'] }, filename, installed);
  assert('changed' in noop && !noop.changed);
  const publish = { name: 'workspace_publish' as const, ...selection, remote: 'origin' };
  git(base, 'remote', 'add', 'ambiguous', 'origin');
  assert.throws(() => executeWorkspaceOperation({ ...publish, remote: 'ambiguous' }, filename, installed), /ambiguous with a configured remote name/);
  assert.equal(git(bare, 'for-each-ref', '--format=%(refname)'), '');
  const published = executeWorkspaceOperation(publish, filename, installed);
  assert('remoteHead' in published && published.remoteHead === head && published.push === 'exited-zero');
  assert.equal(git(bare, 'rev-parse', 'refs/heads/task/exact').trim(), head);
  const again = executeWorkspaceOperation(publish, filename, installed);
  assert('push' in again && again.push === 'not-needed');
  assert(!git(task, 'config', '--list').includes('branch.task/exact.remote='));
  // A rejected non-fast-forward push retains the remote and reports observations, not rollback/success.
  git(base, 'branch', 'remote-ahead', head);
  const remoteTask = join(dir, 'remote-task');
  git(base, 'worktree', 'add', '--quiet', remoteTask, 'remote-ahead');
  git(remoteTask, 'commit', '--quiet', '--allow-empty', '-m', 'remote advances');
  git(remoteTask, 'push', '--quiet', 'origin', 'HEAD:refs/heads/task/exact');
  const advanced = git(bare, 'rev-parse', 'refs/heads/task/exact').trim();
  assert.throws(() => executeWorkspaceOperation(publish, filename, installed), error =>
    error instanceof PartialError && error.saved.includes('remoteHead=' + advanced) && error.message.includes('not confirmed'));
  assert.equal(git(bare, 'rev-parse', 'refs/heads/task/exact').trim(), advanced);
  assert.equal(git(task, 'rev-parse', 'HEAD').trim(), head);
});
