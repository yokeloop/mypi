import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../src/app/create-app.js';
import { createRepositoryBindings } from '../../src/app/repository-bindings.js';
import { observeWriteWorkspace } from '../../src/app/write-workspace-observation.js';
import { preparePiLaunch } from '../../src/app/pi-launcher.js';
import { state } from '../support/state.js';

// Real Git is necessary: registry stubs or fake worktree lists cannot prove membership.
// A single fixture covers independent identity, exact association and absence of writes.
test('repository bindings use independent canonical identity, exact worktree membership and no writes', t => {
  const { dir, filename } = state(t);
  const installed = join(dir, 'engine');
  const base = join(installed, 'projects', 'repo');
  const foreign = join(base, 'vendor', 'repo');
  const task = base + '--task';
  function git(root: string, ...args: string[]): string {
    const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null',
      '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false',
      '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-C', root, ...args], {
      encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    return result.stdout;
  }
  mkdirSync(installed);
  git(installed, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(installed, 'source.txt'), 'unchanged source\n');
  git(installed, 'add', 'source.txt');
  git(installed, 'commit', '--quiet', '-m', 'fixture');
  // Local independent repositories avoid clone's transport shell dependency in the sandbox.
  for (const root of [base, foreign]) {
    mkdirSync(root, { recursive: true });
    git(root, 'init', '--quiet', '--initial-branch=main');
    writeFileSync(join(root, 'source.txt'), 'unchanged source\n');
    git(root, 'add', 'source.txt');
    git(root, 'commit', '--quiet', '-m', 'fixture');
    git(root, 'config', 'remote.origin.url', installed);
  }
  git(base, 'worktree', 'add', '--quiet', '-b', 'task/binding', task);
  const alias = join(dir, 'alias');
  symlinkSync(base, alias);
  const dangling = join(dir, 'dangling');
  symlinkSync(join(dir, 'missing'), dangling);
  mkdirSync(base + '-other');
  // Repository-local config must not turn read-only inspection into execution.
  const marker = join(dir, 'unexpected-hook');
  const hook = join(dir, 'hook');
  writeFileSync(hook, `#!/usr/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
  git(base, 'config', 'core.fsmonitor', hook);
  git(base, 'config', 'core.hooksPath', dir);
  const app = createApp(filename, false);
  t.after(() => app.close());
  // Deliberately wrong convenience checkout: it cannot authorize installed source.
  app.projects.add('one/project', 'MP', installed);
  app.projects.add('one/checkout', 'CP', base);
  const bindings = createRepositoryBindings(app.projects, installed);
  const input = { project: 'one/project', baseRoot: base, worktreeRoot: task, expectedBranch: 'task/binding' };
  function files(root: string): [string, Buffer][] {
    return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? files(path) : [[path, readFileSync(path)] as [string, Buffer]];
    });
  }
  const before = files(installed);
  const refs = [installed, base, foreign].map(root => git(root, 'show-ref'));
  assert.deepEqual(observeWriteWorkspace(task), { selectedRoot: task, baseRoot: base, selectedIsBase: false });
  assert.deepEqual(observeWriteWorkspace(base), { selectedRoot: base, baseRoot: base, selectedIsBase: true });
  assert.deepEqual(observeWriteWorkspace(alias), { selectedRoot: base, baseRoot: base, selectedIsBase: true });
  assert.throws(() => observeWriteWorkspace(join(base, 'vendor')), /Repository evidence unavailable/);
  const binding = bindings.verify(input);
  assert.equal(binding.project, 'one/project');
  assert.equal(binding.baseRoot, base);
  assert.equal(binding.commonDir, join(base, '.git'));
  assert.equal(binding.worktreeRoot, task);
  assert.equal(binding.branch, 'task/binding');
  assert.equal(binding.baseReadOnly, true);
  assert(Object.isFrozen(binding));
  const registry = { projects: app.projects, repositories: bindings };
  const launch = { selection: { kind: 'project' as const, project: 'one/project' }, base: alias, args: ['--no-session'] };
  assert.deepEqual(preparePiLaunch(launch, dir, registry), {
    cwd: base, args: ['--no-session'], context: { version: 1, cwd: base,
      context: { scope: { kind: 'project', project: 'one/project' }, selectedProject: 'one/project', worktreeRoot: base } },
  }, 'explicit base overrides installed registry checkout and becomes default cwd');
  assert.deepEqual(preparePiLaunch({ ...launch, cwd: task }, dir, registry), {
    cwd: task, args: ['--no-session'], context: { version: 1, cwd: task,
      context: { scope: { kind: 'project', project: 'one/project' }, selectedProject: 'one/project', worktreeRoot: task } },
  });
  assert.equal(preparePiLaunch({ selection: { kind: 'project', project: 'one/checkout' }, args: [] }, dir, registry).cwd, base);
  assert.throws(() => preparePiLaunch({ ...launch, cwd: join(base, 'vendor') }, dir, registry), /Repository binding unavailable/);
  assert.deepEqual(bindings.verify({ ...input, baseRoot: alias }), binding);
  assert.equal(bindings.verify({ ...input, worktreeRoot: base, expectedBranch: 'main' }).baseReadOnly, true);
  for (const changed of [
    { project: 'one/missing' }, { project: 'one' },
    { worktreeRoot: foreign }, { worktreeRoot: base + '-other' },
    { worktreeRoot: join(base, 'vendor') }, { worktreeRoot: dangling },
    { expectedBranch: 'other' }, { baseRoot: task },
    { baseRoot: installed, worktreeRoot: installed, expectedBranch: 'main' },
    { baseRoot: dir },
  ]) assert.throws(() => bindings.verify({ ...input, ...changed }), /^InputError: Repository binding unavailable or mismatched$/);
  assert.deepEqual([installed, base, foreign].map(root => git(root, 'show-ref')), refs);
  assert.deepEqual(files(installed), before, 'verification must not change refs, metadata or worktree files');
  assert(!readdirSync(dir).includes('unexpected-hook'));

  git(base, 'worktree', 'lock', task);
  const locked = files(installed);
  assert.throws(() => observeWriteWorkspace(task), /Selected worktree observation unavailable/);
  assert.throws(() => bindings.verify(input), /Repository binding unavailable/);
  assert.deepEqual(files(installed), locked);
  git(base, 'worktree', 'unlock', task);
  git(task, 'checkout', '--quiet', '--detach');
  const detached = files(installed);
  assert.throws(() => observeWriteWorkspace(task), /Selected worktree observation unavailable/);
  assert.throws(() => bindings.verify({ project: input.project, baseRoot: base, worktreeRoot: task }), /Repository binding unavailable/);
  assert.deepEqual(files(installed), detached);
});
