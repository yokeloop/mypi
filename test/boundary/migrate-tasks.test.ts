import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, cpSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { run as executeCommand } from '../../src/cli/run.js';
import { parseCommand } from '../../src/cli/command.js';
import { contextFiles } from '../../src/infrastructure/filesystem/context-files.js';
import { contextGit } from '../../src/infrastructure/git/context-git.js';
import { legacyTask } from '../support/legacy-task.js';

function git(...args: string[]): string {
  const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('home migrate-tasks previews, moves legacy folders in one commit, rewrites paths, resumes and refuses dirty or conflicting homes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  function installation(name: string) {
    const root = join(dir, name); mkdirSync(root);
    cpSync('/work/dist', join(root, 'dist'), { recursive: true });
    symlinkSync('/work/node_modules', join(root, 'node_modules'));
    return root;
  }
  const root = installation('engine'), home = join(root, 'home'), filename = root + '-state/mypi/state.sqlite3';
  function run(where: string, args: string[], expected = 0) {
    const result = spawnSync(process.execPath, [join(where, 'dist/src/cli/main.js'), ...args], {
      env: { PATH: '/work/tools:/usr/bin', HOME: join(dir, 'user'), XDG_STATE_HOME: where + '-state' },
      encoding: 'utf8', timeout: 4000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, expected, result.stderr);
    return JSON.parse(expected ? result.stderr : result.stdout);
  }
  async function cli(...args: string[]) {
    const command = parseCommand(args);
    assert.equal(command.type, 'workspace');
    if (command.type !== 'workspace') throw new Error('Expected workspace command');
    return JSON.parse(JSON.stringify(await executeCommand(command, filename, home)));
  }
  const fingerprints = () => {
    const db = new Database(filename, { readonly: true });
    try { return (db.prepare('SELECT path FROM knowledge_file_fingerprints ORDER BY path').all() as { path: string }[]).map(row => row.path); }
    finally { db.close(); }
  };
  run(root, ['bootstrap']);
  run(root, ['project', 'add', 'one/project', '--code', 'MP']);
  const task = await cli('task', 'create', 'source text', '--project', 'one/project', '--title', 'Task', '--slug', 'task', '--status', 'new');
  assert.equal(task.contextDir, 'projects/one/project/tasks/MP-1-task');
  const legacy = legacyTask(filename, home, 1, 'legacy');
  assert.equal(legacy.contextDir, 'requests/REQ-1-legacy');
  const artifacts = join(dir, 'artifacts.json');
  writeFileSync(artifacts, JSON.stringify([{ path: 'artifacts/result.md', text: 'proof' }]));
  await cli('task', 'progress', 'MP-1', 'progress', '--artifacts', artifacts);
  const legacyArtifacts = join(dir, 'legacy-artifacts.json');
  writeFileSync(legacyArtifacts, JSON.stringify([{ path: 'result.md', text: 'legacy proof' }]));
  await cli('task', 'progress', 'REQ-1', 'legacy progress', '--artifacts', legacyArtifacts);
  await cli('context', 'commit', task.contextDir + '/source.md', task.contextDir + '/artifacts/result.md',
    'requests/REQ-1-legacy/source.md', 'requests/REQ-1-legacy/result.md', '--message', 'Publish task files');
  assert.equal((await cli('backup', join(dir, 'before'))).status, 'ok');
  const head = git('-C', home, 'rev-parse', 'HEAD');
  const shown = await cli('task', 'show', 'MP-1');
  const expected = { moves: [{ from: 'requests/REQ-1-legacy', to: 'tasks/REQ-1-legacy' }],
    rewrites: [{ key: 'REQ-1', from: 'requests/REQ-1-legacy', to: 'tasks/REQ-1-legacy' }] };
  assert.deepEqual(run(root, ['home', 'migrate-tasks', '--dry-run']), { status: 'preview', ...expected });
  assert.equal(existsSync(join(home, 'requests/REQ-1-legacy')), true);
  assert.equal(existsSync(join(home, 'tasks')), false);
  assert.equal(git('-C', home, 'rev-parse', 'HEAD'), head);
  assert.equal((await cli('task', 'show', 'REQ-1')).contextDir, 'requests/REQ-1-legacy');
  const result = await cli('home', 'migrate-tasks');
  assert.deepEqual(result, { status: 'ok', commit: git('-C', home, 'rev-parse', 'HEAD'), ...expected });
  assert.notEqual(result.commit, head);
  assert.equal(git('-C', home, 'log', '-1', '--format=%s'), 'Move task directories from requests/ to tasks/');
  assert.equal(git('-C', home, 'status', '--porcelain'), '');
  assert.equal(existsSync(join(home, 'tasks/REQ-1-legacy/result.md')), true);
  assert.equal(existsSync(join(home, 'requests')), false);
  assert.equal((await cli('task', 'show', 'REQ-1')).contextDir, 'tasks/REQ-1-legacy');
  assert.deepEqual(await cli('task', 'show', 'MP-1'), shown);
  assert.deepEqual((await cli('journal', 'read', '-s', 'task:REQ-1')).map((e: { artifacts?: string[] }) => e.artifacts),
    [['tasks/REQ-1-legacy/result.md']]);
  assert.deepEqual(fingerprints(), ['projects/one/project/tasks/MP-1-task/artifacts/result.md', 'projects/one/project/tasks/MP-1-task/source.md',
    'tasks/REQ-1-legacy/result.md', 'tasks/REQ-1-legacy/source.md']);
  assert.equal((await cli('backup', join(dir, 'after'))).status, 'ok');
  assert.deepEqual(await cli('home', 'migrate-tasks'), { status: 'noop' });
  assert.equal(git('-C', home, 'rev-parse', 'HEAD'), result.commit);
  writeFileSync(join(home, 'scratch.md'), 'dirty');
  const dirty = run(root, ['home', 'migrate-tasks', '--dry-run'], 1);
  assert.equal(dirty.status, 'error');
  assert.match(dirty.message, /Dirty context/);
  rmSync(join(home, 'scratch.md'));
  const second = legacyTask(filename, home, 2, 'moved');
  git('-C', home, 'add', '--', second.contextDir + '/source.md');
  git('-C', home, 'commit', '--quiet', '-m', 'Seed second legacy task');
  git('-C', home, 'mv', 'requests/REQ-2-moved', 'tasks/REQ-2-moved');
  git('-C', home, 'commit', '--quiet', '-m', 'Move by hand');
  const resume = { moves: [], rewrites: [{ key: 'REQ-2', from: 'requests/REQ-2-moved', to: 'tasks/REQ-2-moved' }] };
  assert.deepEqual(run(root, ['home', 'migrate-tasks', '--dry-run']), { status: 'preview', ...resume });
  const head2 = git('-C', home, 'rev-parse', 'HEAD');
  assert.deepEqual(await cli('home', 'migrate-tasks'), { status: 'ok', ...resume });
  assert.equal(git('-C', home, 'rev-parse', 'HEAD'), head2);
  assert.equal((await cli('task', 'show', 'REQ-2')).contextDir, 'tasks/REQ-2-moved');
  assert.equal((await cli('backup', join(dir, 'resumed'))).status, 'ok');
  legacyTask(filename, home, 3, 'both');
  contextFiles(home).create('tasks/REQ-3-both/source.md', 'other');
  contextGit(home).commit(['requests/REQ-3-both/source.md', 'tasks/REQ-3-both/source.md'], 'Seed conflict');
  const conflict = run(root, ['home', 'migrate-tasks', '--dry-run'], 1);
  assert.match(conflict.message, /Target directory exists: tasks\/REQ-3-both/);
});
