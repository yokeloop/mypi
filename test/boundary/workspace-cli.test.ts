import { run as executeCommand } from '../../src/cli/run.js';
import { parseCommand } from '../../src/cli/command.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { executeCommand as appExecute } from '../../src/app/execute-command.js';
import type { AppCommand, WorkContext } from '../../src/app/commands.js';
import { DEFAULT_GUARD_POLICY } from '../../src/modules/work-context/public.js';

test('complete Node CLI dispatch: memory/context/request lifecycle, partial repair, backup and restore into a fresh installation', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-cli-all-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  function installation(name: string) {
    const root = join(dir, name); mkdirSync(root);
    cpSync('/work/dist', join(root, 'dist'), { recursive: true });
    symlinkSync('/work/node_modules', join(root, 'node_modules'));
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
  async function cli(...args: string[]) {
    const command = parseCommand(args);
    assert.equal(command.type, 'workspace');
    if (command.type !== 'workspace') throw new Error('Expected workspace command');
    return JSON.parse(JSON.stringify(await executeCommand(command, root + '-state/mypi/state.sqlite3', join(root, 'home'))));
  }
  run(root, ['bootstrap']);
  run(root, ['context', 'read', 'missing.md'], 1);
  run(root, ['project', 'add', 'one/project', '--code', 'MP']);
  await cli('memory', 'add', 'global\nline');
  run(root, ['project', 'add', 'global/project', '--code', 'GL']);
  await cli('memory', 'add', 'org-only', '-s', 'global');
  assert.equal((await cli('memory', 'show', '-s', 'global')).items[0].text, 'org-only');
  assert.equal((await cli('memory', 'show')).items.length, 1, 'organization global is not global scope');
  await assert.rejects(cli('memory', 'add', 'invalid scope', '--scope', ''), /Invalid organization/);
  await cli('memory', 'add', 'scoped', '-s', 'one/project');
  assert.equal((await cli('memory', 'show', '-s', 'one/project')).items[0].text, 'scoped');
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
  const request = await cli('request', 'create', '--file', source, '--project', 'one/project',
    '--title', 'Task', '--slug', 'task', '--status', 'planning');
  assert.equal(request.key, 'MP-1');
  const selected: WorkContext = { scope: { kind: 'project', project: 'one/project' } };
  const database = root + '-state/mypi/state.sqlite3', home = join(root, 'home');
  const contextual = async (args: string[]) => JSON.parse(JSON.stringify(await executeCommand(parseCommand(args), database, home, selected)));
  const scoped = (command: AppCommand, context = selected, policy = DEFAULT_GUARD_POLICY) => appExecute(command, database, home, context, policy);
  assert.equal((await contextual(['memory', 'show'])).items[0].text, 'scoped');
  const inherited = JSON.stringify(await contextual(['warmup']));
  assert(inherited.includes('global\\nline') && inherited.includes('scoped'));
  assert.deepEqual((await contextual(['request', 'list'])).map((card: { key: string }) => card.key), ['MP-1']);
  assert.deepEqual((await contextual(['project', 'list'])).projects.map((p: { code: string }) => p.code), ['MP']);
  const globalBefore = readFileSync(join(home, 'MEMORY.md'), 'utf8');
  await assert.rejects(scoped({ name: 'memory_add', scope: { type: 'global' }, text: 'blocked' }), /outside the working selection/);
  assert.equal(readFileSync(join(home, 'MEMORY.md'), 'utf8'), globalBefore);
  await assert.rejects(scoped({ name: 'request_create', project: null, title: 'Bad', status: 'new', slug: 'bad',
    source: { file: join(dir, 'missing-source') } }), /outside the working selection/);
  const policyFile = join(dir, 'warn.yaml');
  writeFileSync(policyFile, 'version: 2\nguards: {foreignMypiTarget: warn}\n');
  const previousPolicy = process.env['MYPI_GUARD_POLICY'];
  try {
    process.env['MYPI_GUARD_POLICY'] = policyFile;
    const warned = await contextual(['memory', 'add', 'warned effect', '-s', 'global/project']);
    assert.deepEqual(warned.data, { path: 'projects/global/project/MEMORY.md' });
    assert.equal(warned.warnings[0].guard, 'foreignMypiTarget');
    assert.equal(warned.warnings[0].behavior, 'warn');
    assert.equal((await cli('memory', 'show', '-s', 'global/project')).items[0].text, 'warned effect');
  } finally {
    if (previousPolicy === undefined) delete process.env['MYPI_GUARD_POLICY']; else process.env['MYPI_GUARD_POLICY'] = previousPolicy;
  }
  assert.deepEqual(await scoped({ name: 'memory_show', scope: { type: 'global' } }, { scope: { kind: 'unrestricted' } }),
    await appExecute({ name: 'memory_show' }, database, home));
  assert.equal((await cli('request', 'list', '--status', 'planning')).length, 1);
  await cli('request', 'title', request.key, 'Renamed', '--reason', 'clarification');
  const artifacts = join(dir, 'artifacts.json');
  writeFileSync(artifacts, JSON.stringify([{ path: 'artifacts/proof.md', text: 'proof' }]));
  await cli('request', 'progress', request.key, 'progress', '--artifacts', artifacts);
  await cli('status', 'add', 'accepted', '--terminal');
  await cli('status', 'rename', 'accepted', 'verified');
  writeFileSync(join(root, 'home/.git/index.lock'), 'busy');
  const partial = run(root, ['request', 'status', request.key, 'verified', '--reason', 'verified'], 1);
  assert.equal(partial.status, 'partial'); assert.equal(partial.requestId, request.id);
  assert.equal((await cli('request', 'show', request.key)).status, 'verified');
  rmSync(join(root, 'home/.git/index.lock'));
  const pendingEvent = (await cli('journal', 'read', '-s', 'request:MP-1', '--type', 'status_changed'))[0];
  const log = 'journal/' + pendingEvent.at.slice(0, 7) + '.jsonl';
  const before = readFileSync(join(root, 'home', log), 'utf8');
  await cli('context', 'commit', log, '--message', 'complete checked partial');
  assert.equal(readFileSync(join(root, 'home', log), 'utf8'), before);
  assert.equal((await cli('journal', 'read', '-s', 'request:MP-1', '--type', 'status_changed')).length, 1);
  assert(!JSON.stringify(await cli('warmup', '-s', 'one/project')).includes('original'));
  await cli('memory', 'remove', '1');
  const snapshot = join(dir, 'snapshot'); await cli('backup', snapshot);
  const restored = installation('restored');
  run(restored, ['restore', snapshot]);
  assert.equal(run(restored, ['request', 'show', request.key]).status, 'verified');
  run(restored, ['restore', snapshot], 1);
  const standalone = await cli('request', 'create', 'operator source', '--title', 'Standalone', '--slug', 'standalone', '--status', 'new');
  assert.equal(standalone.projectId, null); assert.equal(standalone.key, 'REQ-1');
});
