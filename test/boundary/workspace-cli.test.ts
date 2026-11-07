import { run as executeCommand } from '../../src/cli/run.js';
import { parseCommand } from '../../src/cli/command.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, cpSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('complete Node CLI dispatch: context/task lifecycle, partial repair, backup and restore into a fresh installation', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-all-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  function installation(name: string) {
    const root = join(dir, name); mkdirSync(root);
    cpSync('/work/dist', join(root, 'dist'), { recursive: true });
    symlinkSync('/work/node_modules', join(root, 'node_modules'));
    symlinkSync('/work/integrations', join(root, 'integrations'));
    return root;
  }
  const root = installation('engine');
  function run(where: string, args: string[], expected = 0) {
    const result = spawnSync(process.execPath, [join(where, 'dist/src/cli/main.js'), ...args], {
      env: { PATH: '/work/tools:/usr/bin', HOME: join(dir, 'user'), XDG_STATE_HOME: where + '-state' },
      encoding: 'utf8', timeout: 4000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, expected, result.stderr);
    return JSON.parse(expected ? result.stderr : result.stdout);
  }
  function text(args: string[], env: Record<string, string> = {}, expected = 0): string {
    const result = spawnSync(process.execPath, [join(root, 'dist/src/cli/main.js'), ...args], {
      env: { PATH: '/work/tools:/usr/bin', HOME: join(dir, 'user'), XDG_STATE_HOME: root + '-state', ...env },
      encoding: 'utf8', timeout: 4000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, expected, result.stderr);
    return expected ? result.stderr : result.stdout;
  }
  async function cli(...args: string[]) {
    const command = parseCommand(args);
    assert.equal(command.type, 'workspace');
    if (command.type !== 'workspace') throw new Error('Expected workspace command');
    return JSON.parse(JSON.stringify(await executeCommand(command, root + '-state/mypi/state.sqlite3', join(root, 'home'))));
  }
  run(root, ['bootstrap']);
  run(root, ['context', 'read', 'missing.md'], 1);
  run(root, ['project', 'add', 'one/project', '--code', 'MP']);
  writeFileSync(join(root, 'home/INDEX.md'), 'global\nline\n');
  run(root, ['project', 'add', 'global/project', '--code', 'GL']);
  mkdirSync(join(root, 'home/projects/global'), { recursive: true });
  writeFileSync(join(root, 'home/projects/global/INDEX.md'), 'org-only\n');
  await assert.rejects(cli('note', 'Invalid', 'invalid scope', '--scope', ''), /Invalid organization/);
  mkdirSync(join(root, 'home/projects/one/project'), { recursive: true });
  writeFileSync(join(root, 'home/projects/one/project/INDEX.md'), 'scoped\n');
  assert.match((await cli('context', 'commit', 'INDEX.md', 'projects/global/INDEX.md', 'projects/one/project/INDEX.md',
    '--message', 'Add knowledge entries')).commit, /^[0-9a-f]{40}$/);
  assert.equal((await cli('context', 'read', 'projects/global/INDEX.md')).text, 'org-only\n');
  assert.equal((await cli('context', 'read', 'INDEX.md')).text, 'global\nline\n');
  const source = join(dir, 'source.md'); writeFileSync(source, '\ufeff  original\r\n');
  const capture = (await cli('capture', '--file', source)).path;
  assert.equal((await cli('context', 'read', capture)).text, '\ufeff  original\r\n');
  await cli('note', 'Title', 'Note', '-s', 'one/project');
  await cli('error', 'one/project', 'dead end');
  await cli('journal', 'add', 'project outcome', '-s', 'one/project');
  await assert.rejects(cli('journal', 'read', '-s', 'all'), /Unknown organization/);
  run(root, ['project', 'add', 'all/project', '--code', 'AP']);
  await cli('journal', 'add', 'org-only outcome', '-s', 'all');
  assert.deepEqual((await cli('journal', 'read', '-s', 'all')).map((e: { text: string }) => e.text), ['org-only outcome']);
  assert.equal((await cli('journal', 'read', '--all')).length, 2);
  const task = await cli('task', 'create', '--file', source, '--project', 'one/project',
    '--title', 'Task', '--slug', 'task', '--status', 'planning');
  assert.equal(task.key, 'MP-1');
  assert.equal((await cli('task', 'list', '--status', 'planning')).length, 1);
  await cli('task', 'title', task.key, 'Renamed', '--reason', 'clarification');
  const artifacts = join(dir, 'artifacts.json');
  writeFileSync(artifacts, JSON.stringify([{ path: 'artifacts/proof.md', text: 'proof' }]));
  await cli('task', 'progress', task.key, 'progress', '--artifacts', artifacts);
  await cli('status', 'add', 'accepted', '--terminal');
  await cli('status', 'rename', 'accepted', 'verified');
  writeFileSync(join(root, 'home/.git/index.lock'), 'busy');
  run(root, ['task', 'status', task.key, 'verified', '--reason', 'verified']);
  assert.equal((await cli('task', 'show', task.key)).status, 'verified');
  rmSync(join(root, 'home/.git/index.lock'));
  await cli('context', 'commit', task.contextDir + '/source.md', task.contextDir + '/artifacts/proof.md', '--message', 'Publish files for backup');
  assert.equal((await cli('journal', 'read', '-s', 'task:MP-1', '--type', 'status_changed')).length, 1);
  assert.equal((await cli('journal', 'read', '-s', 'task:MP-1', '--type', 'title_changed')).length, 1);
  const warm = text(['warmup']);
  assert.match(warm, /^# mypi warmup: global\n/); assert(warm.includes('## Role: global')); assert(!warm.includes('original'));
  assert.match(text(['warmup', '-s', 'MP'], {}, 1), /"status":"error","message":"Project one\/project \(MP\) has no clone/);
  assert.match(text(['warmup'], { MYPI_SCOPE: 'MP' }, 1), /has no clone/);
  assert.match(text(['warmup', '--scope', 'global'], { MYPI_SCOPE: 'MP' }), /^# mypi warmup: global\n/);
  const snapshot = join(dir, 'snapshot'); await cli('backup', snapshot);
  const restored = installation('restored');
  run(restored, ['restore', snapshot]);
  assert.equal(run(restored, ['task', 'show', task.key]).status, 'verified');
  assert.equal(run(restored, ['context', 'read', 'projects/one/project/INDEX.md']).text, 'scoped\n');
  run(restored, ['restore', snapshot], 1);
});
