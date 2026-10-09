import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../src/app/create-app.js';
import { executeWorkspaceOperation } from '../../src/app/workspace-operations.js';
import { executeCommand } from '../../src/app/execute-command.js';
import { PartialError } from '../../src/shared/context.js';
import { InputError } from '../../src/shared/errors.js';
import { state } from '../support/state.js';

// Native Git is the oracle for exact-path commit/index preservation and remote ref state.
// One local cycle; no network, model, personal data or subprocess matrix.
test('workspace helpers preserve unrelated materials through prepare, exact commit and confirmed local publication', async t => {
  const { dir, filename } = state(t);
  const oldSessionDirectory = process.env['MYPI_SESSION_DIR'], sessionDirectory = join(dir, 'absent-session-cache');
  process.env['MYPI_SESSION_DIR'] = sessionDirectory;
  t.after(() => { if (oldSessionDirectory === undefined) delete process.env['MYPI_SESSION_DIR']; else process.env['MYPI_SESSION_DIR'] = oldSessionDirectory; });
  const installed = join(dir, 'engine'), base = join(dir, 'base'), bare = join(dir, 'remote.git');
  const task = join(installed, 'projects', 'task'); // Independent worktrees nested under installation remain supported.
  function git(root: string, ...args: string[]) {
    const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
      '-c', 'commit.gpgsign=false', '-C', root, ...args], { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    return result.stdout;
  }
  const configText = JSON.stringify({ version: 1, commands: [{ argv: [process.execPath, 'check.cjs'] }] });
  for (const root of [installed, base]) {
    mkdirSync(root);
    git(root, 'init', '--quiet', '--initial-branch=main');
    git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@localhost');
    for (const name of ['changed.txt', 'deleted.txt', 'unrelated.txt', 'ambiguous.txt']) writeFileSync(join(root, name), 'original\n');
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\ncheck-output.json\n');
    writeFileSync(join(root, 'fixture.lock'), 'locked\n');
    writeFileSync(join(root, 'check.cjs'), `const fs = require('node:fs');
const text = fs.readFileSync('changed.txt', 'utf8');
fs.writeFileSync('check-output.json', JSON.stringify({ text, exitCode: text === 'FAIL' ? 7 : 0 }));
if (text === 'MUTATE') fs.writeFileSync('changed.txt', 'changed during check');
process.exitCode = text === 'FAIL' ? 7 : 0;
`);
    git(root, 'add', '.gitignore', 'fixture.lock', 'check.cjs', 'changed.txt', 'deleted.txt', 'unrelated.txt', 'ambiguous.txt');
    git(root, 'commit', '--quiet', '-m', 'fixture');
  }
  mkdirSync(join(installed, 'projects'));
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
  const metadataAlias = join(dir, 'installed-metadata');
  symlinkSync(join(installed, '.git'), metadataAlias);
  const forbiddenTarget = join(metadataAlias, 'forbidden-task');
  const beforePrepareRefs = git(base, 'show-ref'), beforePrepareWorktrees = git(base, 'worktree', 'list', '--porcelain', '-z');
  assert.throws(() => executeWorkspaceOperation({ ...prepare, worktreeRoot: forbiddenTarget, branch: 'task/forbidden-metadata' }, filename, installed),
    error => error instanceof InputError && /protected Git metadata/.test(error.message));
  assert(!existsSync(forbiddenTarget));
  assert(!existsSync(join(installed, '.git', 'forbidden-task')));
  assert.equal(git(base, 'show-ref'), beforePrepareRefs, 'no branch creation before metadata refusal');
  assert.equal(git(base, 'worktree', 'list', '--porcelain', '-z'), beforePrepareWorktrees, 'no worktree registration before metadata refusal');
  writeFileSync(join(base, 'changed.txt'), 'dirty base remains\n');
  const baseHead = git(base, 'rev-parse', 'HEAD');
  const prepared = executeWorkspaceOperation(prepare, filename, installed);
  assert('status' in prepared && prepared.status === 'ok');
  assert.equal(git(base, 'symbolic-ref', '--short', 'HEAD').trim(), 'main');
  assert.equal(git(base, 'rev-parse', 'HEAD'), baseHead);
  assert.equal(readFileSync(join(base, 'changed.txt'), 'utf8'), 'dirty base remains\n');
  assert.equal(readFileSync(join(task, 'changed.txt'), 'utf8'), 'original\n');
  const inspect = () => executeWorkspaceOperation({ name: 'workspace_inspect', ...selection }, filename, installed);
  const verify = () => executeWorkspaceOperation({ name: 'workspace_verify', ...selection }, filename, installed);
  const cachePath = git(task, 'rev-parse', '--path-format=absolute', '--git-path', 'mypi-workspace-check.json').trim();
  const checkState = () => {
    const result = inspect();
    assert('verification' in result);
    return result.verification.state;
  };
  function preview(remote?: string) {
    const indexPath = git(task, 'rev-parse', '--path-format=absolute', '--git-path', 'index').trim();
    const snapshot = () => ({ index: readFileSync(indexPath), refs: git(base, 'show-ref'),
      remoteRefs: git(bare, 'for-each-ref', '--format=%(refname) %(objectname)'),
      registrations: git(base, 'worktree', 'list', '--porcelain', '-z'),
      cache: existsSync(cachePath) ? readFileSync(cachePath) : null,
      files: ['ignored.txt', 'unrelated.txt', 'untracked.txt', 'changed.txt'].map(path => existsSync(join(task, path)) ? readFileSync(join(task, path)) : null),
    });
    const before = snapshot();
    const result = executeWorkspaceOperation({ name: 'workspace_cleanup_preview', ...selection,
      ...(remote === undefined ? {} : { remote }) }, filename, installed);
    assert('inventory' in result);
    assert.deepEqual(snapshot(), before, 'preview preserves exact index/cache/file bytes, local/remote refs and worktree registration');
    assert(!existsSync(sessionDirectory), 'preview must not initialize session observations');
    assert.equal(result.deletionAuthorized, false);
    assert.equal(result.decision, 'manual-review');
    assert(result.diagnostics.some(message => message.includes('never prove writer absence')));
    return result;
  }
  assert.equal(checkState(), 'absent'); assert(!existsSync(cachePath), 'inspection does not initialize cache');
  const initialPreview = preview();
  assert.equal(initialPreview.publication.state, 'not-observed');
  assert.equal(initialPreview.inventory.state, 'complete');
  assert.deepEqual(initialPreview.cards, { hints: [], issues: [], truncated: false });
  assert.throws(() => executeWorkspaceOperation({ name: 'workspace_cleanup_preview', ...selection, branch: 'wrong' }, filename, installed), /binding unavailable/);
  assert.throws(verify, /stage the project-owned/);
  writeFileSync(join(task, '.mypi-checks.json'), configText);
  assert.throws(verify, /stage the project-owned/, 'untracked configuration is not silently adopted');
  git(task, 'add', '.mypi-checks.json'); // Explicit initial project-owned configuration adoption.
  git(base, 'worktree', 'lock', task);
  const locked = inspect();
  assert('mutationUnavailable' in locked && locked.mutationUnavailable);
  assert('worktrees' in locked && locked.worktrees.some(tree => tree.root === task && tree.locked));
  git(base, 'worktree', 'unlock', task);
  writeFileSync(join(task, 'unrelated.txt'), 'staged unrelated\n'); git(task, 'add', 'unrelated.txt');
  writeFileSync(join(task, 'unrelated.txt'), 'working unrelated\n');
  writeFileSync(join(task, 'untracked.txt'), 'untracked bytes\n'); writeFileSync(join(task, 'ignored.txt'), 'ignored bytes\n');
  const unrelatedIndex = git(task, 'ls-files', '--stage', 'unrelated.txt');
  const dirtyPreview = preview('origin');
  assert.equal(dirtyPreview.publication.state, 'missing-ref');
  assert.equal(dirtyPreview.publication.remoteHead, null);
  assert(dirtyPreview.inventory.tracked.includes('unrelated.txt'));
  assert(dirtyPreview.inventory.changes.some(entry => entry.path === 'unrelated.txt' && entry.index === 'M' && entry.worktree === 'M'));
  assert.deepEqual(dirtyPreview.inventory.untracked, ['untracked.txt']);
  assert.deepEqual(dirtyPreview.inventory.ignored, ['ignored.txt']);
  assert(dirtyPreview.diagnostics.some(message => message.includes('may be unique')));
  assert(dirtyPreview.diagnostics.some(message => message.includes('unknown value')));
  const unknownPreview = preview('unconfigured');
  assert.equal(unknownPreview.publication.state, 'unavailable');
  assert(!JSON.stringify(unknownPreview.publication).includes(bare), 'publication never exposes destination URL');
  writeFileSync(join(task, 'ambiguous.txt'), 'staged preimage\n'); git(task, 'add', 'ambiguous.txt');
  writeFileSync(join(task, 'ambiguous.txt'), 'working version\n');
  const commit = { name: 'workspace_commit' as const, ...selection, paths: ['ambiguous.txt'], message: 'exact files' };
  const beforeRefusal = git(task, 'ls-files', '--stage');
  assert.throws(() => executeWorkspaceOperation(commit, filename, installed), /staged content differs/);
  assert.equal(git(task, 'ls-files', '--stage'), beforeRefusal);
  assert.equal(git(task, 'rev-parse', 'HEAD'), baseHead);
  assert.throws(() => executeWorkspaceOperation({ ...commit, paths: ['ignored.txt'] }, filename, installed), /Ignored or unavailable/);
  assert.equal(git(task, 'ls-files', '--stage'), beforeRefusal);
  for (const [flag, marker] of [['assume-unchanged', 'h'], ['skip-worktree', 'S']]) {
    git(task, 'update-index', '--' + flag, '--', 'changed.txt');
    writeFileSync(join(task, 'changed.txt'), 'hidden change: ' + flag + '\n');
    assert.equal(git(task, 'ls-files', '-v', '--', 'changed.txt'), marker + ' changed.txt\n');
    const flaggedIndex = git(task, 'ls-files', '-v', '--stage', '-z');
    if (flag === 'assume-unchanged') {
      const incomplete = preview();
      assert.equal(incomplete.inventory.state, 'incomplete');
      assert(incomplete.inventory.issues.some(issue => issue.includes('Assume-unchanged')));
      assert(incomplete.inventory.ignored.includes('ignored.txt'), 'unsupported status cannot erase known material');
    }
    assert.throws(() => executeWorkspaceOperation({ ...commit, paths: ['changed.txt'] }, filename, installed),
      error => error instanceof InputError && /assume-unchanged or skip-worktree flags/.test(error.message));
    assert.equal(git(task, 'ls-files', '-v', '--stage', '-z'), flaggedIndex, 'refusal preserves index entries and flags');
    assert.equal(git(task, 'rev-parse', 'HEAD'), baseHead);
    assert.equal(readFileSync(join(task, 'changed.txt'), 'utf8'), 'hidden change: ' + flag + '\n');
    git(task, 'update-index', '--no-' + flag, '--', 'changed.txt'); // Fixture alone reconciles its flag.
  }
  writeFileSync(join(task, 'changed.txt'), 'changed\n'); rmSync(join(task, 'deleted.txt'));
  git(task, 'add', 'deleted.txt'); // A declared already-staged deletion must work too.
  writeFileSync(join(task, 'literal[1].txt'), 'literal new file\n');
  writeFileSync(join(task, 'literal1.txt'), 'not a pathspec match\n');
  const exact = { ...commit, paths: ['.mypi-checks.json', 'changed.txt', 'deleted.txt', 'literal[1].txt'] };
  const beforeCheckIndex = git(task, 'ls-files', '--stage');
  assert.throws(() => executeWorkspaceOperation(exact, filename, installed), /Checked material unavailable/);
  assert.equal(git(task, 'ls-files', '--stage'), beforeCheckIndex);
  assert.throws(() => executeWorkspaceOperation({ name: 'workspace_verify', ...selection, branch: 'wrong' }, filename, installed), /binding unavailable/);
  verify();
  assert.equal(checkState(), 'current');
  assert.deepEqual(JSON.parse(readFileSync(join(task, 'check-output.json'), 'utf8')), { text: 'changed\n', exitCode: 0 });
  const passedCache = JSON.parse(readFileSync(cachePath, 'utf8'));
  assert.equal(passedCache.state, 'passed'); assert.equal(passedCache.outcomes[0].exitCode, 0);
  for (const path of ['fixture.lock', '.mypi-checks.json', 'literal[1].txt']) {
    const before = readFileSync(join(task, path));
    writeFileSync(join(task, path), Buffer.concat([before, Buffer.from('\n')]));
    assert.equal(checkState(), 'stale', path);
    assert.throws(() => executeWorkspaceOperation({ ...commit, paths: ['changed.txt'] }, filename, installed), /Checked material stale/);
    assert.equal(git(task, 'ls-files', '--stage'), beforeCheckIndex);
    writeFileSync(join(task, path), before);
  }
  writeFileSync(join(task, 'new-after-check.txt'), 'new'); assert.equal(checkState(), 'stale');
  rmSync(join(task, 'new-after-check.txt'));
  assert.equal(git(task, 'show', ':.mypi-checks.json'), readFileSync(join(task, '.mypi-checks.json'), 'utf8'),
    'restored configuration has identical index/working bytes despite changed stat metadata');
  assert.equal(checkState(), 'current');
  const denied = join(task, 'unreadable');
  const indexPath = git(task, 'rev-parse', '--path-format=absolute', '--git-path', 'index').trim();
  const preserved = () => ({ index: readFileSync(indexPath), refs: git(base, 'show-ref'),
    remoteRefs: git(bare, 'for-each-ref', '--format=%(refname) %(objectname)'),
    files: ['changed.txt', 'unrelated.txt', 'untracked.txt', 'ignored.txt', 'check-output.json'].map(path => readFileSync(join(task, path))),
  });
  const beforeDenied = preserved(), greenCache = readFileSync(cachePath);
  mkdirSync(denied); writeFileSync(join(denied, 'unique.txt'), 'preserve unreadable bytes'); chmodSync(denied, 0);
  try {
    const raw = spawnSync('/usr/bin/git', ['-c', 'core.fsmonitor=false', '-C', task, 'ls-files', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
    assert.equal(raw.status, 0); assert.match(raw.stderr, /Permission denied/);
    assert(raw.stdout.split('\0').includes('untracked.txt'));
    assert(!raw.stdout.includes('unreadable/unique.txt'));
    const deniedPreview = preview();
    assert.equal(deniedPreview.inventory.state, 'incomplete', 'permission warning is not complete inventory');
    assert(deniedPreview.inventory.issues.some(issue => issue.includes('inventory warning')));
    assert(deniedPreview.inventory.tracked.includes('changed.txt'), 'warning retains known material');
    assert(!JSON.stringify(deniedPreview.inventory).includes(raw.stderr.trim()), 'raw stderr is not disclosed');
    assert.equal(checkState(), 'unavailable', 'incomplete inventory cannot reuse prior green');
    assert.throws(() => executeWorkspaceOperation(exact, filename, installed), /Checked material unavailable/);
    assert.throws(() => executeWorkspaceOperation({ name: 'workspace_publish', ...selection, remote: 'origin' }, filename, installed), /Checked material unavailable/);
    assert.deepEqual(readFileSync(cachePath), greenCache, 'read-only guards do not replace the cache');
    assert.deepEqual(preserved(), beforeDenied, 'unavailable guards preserve index, refs and files');
    assert.throws(verify, error => error instanceof InputError
      && error.message === 'Checked material unavailable: Git inventory observation failed');
    const unavailableCache = JSON.parse(readFileSync(cachePath, 'utf8'));
    assert.equal(unavailableCache.state, 'unavailable');
    assert.deepEqual(unavailableCache.outcomes, [], 'incomplete inventory refuses before prescribed commands');
    assert.deepEqual(preserved(), beforeDenied, 'refused verification changes only its attempted cache');
  } finally {
    chmodSync(denied, 0o700);
    try { assert.equal(readFileSync(join(denied, 'unique.txt'), 'utf8'), 'preserve unreadable bytes'); }
    finally { rmSync(denied, { recursive: true }); }
  }
  assert.equal(checkState(), 'unavailable', 'restoring access cannot revive superseded green');
  writeFileSync(join(task, 'changed.txt'), 'FAIL');
  assert.throws(verify, /check failed/);
  assert.deepEqual(JSON.parse(readFileSync(join(task, 'check-output.json'), 'utf8')), { text: 'FAIL', exitCode: 7 });
  assert.equal(JSON.parse(readFileSync(cachePath, 'utf8')).outcomes[0].exitCode, 7);
  writeFileSync(join(task, 'changed.txt'), 'changed\n');
  assert.equal(checkState(), 'failed', 'restoring old content cannot revive a failed attempt');
  writeFileSync(join(task, 'changed.txt'), 'MUTATE');
  assert.throws(verify, /changed during verification/);
  assert.equal(readFileSync(join(task, 'changed.txt'), 'utf8'), 'changed during check');
  assert.equal(JSON.parse(readFileSync(cachePath, 'utf8')).state, 'unavailable');
  writeFileSync(join(task, 'changed.txt'), 'changed\n'); verify();
  const successfulAttempt = readFileSync(cachePath, 'utf8');
  const result = executeWorkspaceOperation(exact, filename, installed);
  assert('changed' in result && result.changed);
  let head = git(task, 'rev-parse', 'HEAD').trim();
  assert.deepEqual(git(task, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').trim().split('\n'),
    ['.mypi-checks.json', 'changed.txt', 'deleted.txt', 'literal[1].txt']);
  assert.equal(git(task, 'show', 'HEAD:changed.txt'), 'changed\n');
  assert.equal(git(task, 'show', 'HEAD:literal[1].txt'), 'literal new file\n');
  assert.equal(git(task, 'ls-files', '--stage', 'unrelated.txt'), unrelatedIndex);
  for (const [name, text] of [['unrelated.txt', 'working unrelated\n'], ['untracked.txt', 'untracked bytes\n'],
    ['ignored.txt', 'ignored bytes\n'], ['literal1.txt', 'not a pathspec match\n'], ['ambiguous.txt', 'working version\n']]) {
    assert.equal(readFileSync(join(task, name!), 'utf8'), text);
  }
  const noop = executeWorkspaceOperation({ ...commit, paths: ['changed.txt'] }, filename, installed);
  assert('changed' in noop && !noop.changed);
  assert.equal(checkState(), 'current');
  assert.equal(readFileSync(cachePath, 'utf8'), successfulAttempt, 'exact commit/noop reuse checked bytes, no rerun');
  const publish = { name: 'workspace_publish' as const, ...selection, remote: 'origin' };
  assert.throws(() => executeWorkspaceOperation(publish, filename, installed), /uncommitted companion content/);
  assert.equal(git(bare, 'for-each-ref', '--format=%(refname)'), '');
  assert.equal(git(task, 'ls-files', '--stage', 'unrelated.txt'), unrelatedIndex);
  // Only the fixture operator reconciles its intentionally ambiguous index, without changing bytes.
  git(task, 'add', 'ambiguous.txt', 'unrelated.txt');
  const companions = ['ambiguous.txt', 'unrelated.txt', 'untracked.txt', 'literal1.txt'];
  executeWorkspaceOperation({ ...commit, paths: companions }, filename, installed);
  assert.equal(git(task, 'show', 'HEAD:unrelated.txt'), 'working unrelated\n');
  assert.equal(git(task, 'show', 'HEAD:untracked.txt'), 'untracked bytes\n');
  assert.equal(readFileSync(join(task, 'ignored.txt'), 'utf8'), 'ignored bytes\n');
  assert.equal(readFileSync(cachePath, 'utf8'), successfulAttempt, 'full content-equivalent commit still reuses checks');
  head = git(task, 'rev-parse', 'HEAD').trim();
  git(base, 'remote', 'add', 'ambiguous', 'origin');
  assert.throws(() => executeWorkspaceOperation({ ...publish, remote: 'ambiguous' }, filename, installed), /ambiguous with a configured remote name/);
  assert.equal(git(bare, 'for-each-ref', '--format=%(refname)'), '');
  const published = executeWorkspaceOperation(publish, filename, installed);
  assert('remoteHead' in published && published.remoteHead === head && published.push === 'exited-zero');
  assert.equal(git(bare, 'rev-parse', 'refs/heads/task/exact').trim(), head);
  const publishedPreview = preview('origin');
  assert.equal(publishedPreview.publication.state, 'matches-head');
  assert.equal(publishedPreview.publication.remoteHead, head);
  assert(publishedPreview.inventory.ignored.includes('ignored.txt'));
  assert.equal(readFileSync(join(task, 'ignored.txt'), 'utf8'), 'ignored bytes\n');
  const again = executeWorkspaceOperation(publish, filename, installed);
  assert('push' in again && again.push === 'not-needed');
  assert(!git(task, 'config', '--list').includes('branch.task/exact.remote='));
  // A rejected non-fast-forward push retains the remote and reports observations, not rollback/success.
  git(base, 'branch', 'remote-ahead', head);
  const remoteTask = join(dir, 'remote-task');
  git(base, 'worktree', 'add', '--quiet', remoteTask, 'remote-ahead');
  const otherCache = git(remoteTask, 'rev-parse', '--path-format=absolute', '--git-path', 'mypi-workspace-check.json').trim();
  assert.notEqual(otherCache, cachePath); assert(!existsSync(otherCache));
  executeWorkspaceOperation({ name: 'workspace_verify', ...selection, worktreeRoot: remoteTask, branch: 'remote-ahead' }, filename, installed);
  assert.equal(JSON.parse(readFileSync(otherCache, 'utf8')).state, 'passed');
  assert.equal(readFileSync(cachePath, 'utf8'), successfulAttempt, 'linked worktrees have independent caches');
  git(remoteTask, 'commit', '--quiet', '--allow-empty', '-m', 'remote advances');
  git(remoteTask, 'push', '--quiet', 'origin', 'HEAD:refs/heads/task/exact');
  const advanced = git(bare, 'rev-parse', 'refs/heads/task/exact').trim();
  const differentPreview = preview('origin');
  assert.equal(differentPreview.publication.state, 'different-head');
  assert.equal(differentPreview.publication.remoteHead, advanced);
  assert.throws(() => executeWorkspaceOperation(publish, filename, installed), error =>
    error instanceof PartialError && error.saved.includes('remoteHead=' + advanced) && error.message.includes('not confirmed'));
  assert.equal(git(bare, 'rev-parse', 'refs/heads/task/exact').trim(), advanced);
  assert.equal(git(task, 'rev-parse', 'HEAD').trim(), head);
});
