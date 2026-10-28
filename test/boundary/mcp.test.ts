import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('real stdio: twelve tools, maintenance absent, exact source, scope, task_update partial, two clients and CLI', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-mcp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  function install(name: string) {
    const root = join(dir, name); mkdirSync(root);
    cpSync('/work/dist', join(root, 'dist'), { recursive: true });
    symlinkSync('/work/node_modules', join(root, 'node_modules'));
    symlinkSync('/work/integrations', join(root, 'integrations'));
    return root;
  }
  const root = install('engine'), home = join(root, 'home'), scope = { type: 'project', key: 'MP' };
  const env = (where: string) => ({ PATH: '/work/tools:/usr/bin', HOME: join(dir, 'user'), XDG_STATE_HOME: where + '-state',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
  async function connect(where: string) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(where, 'dist/src/mcp/main.js')],
      cwd: dir, env: env(where), stderr: 'pipe' });
    let stderr = '';
    transport.stderr?.on('data', b => { stderr += String(b); });
    const client = new Client({ name: 'test', version: '1' });
    t.after(async () => { await client.close(); assert.equal(stderr, ''); });
    await client.connect(transport);
    assert.equal(client.getInstructions(), undefined, 'connection must not inject an agent workflow');
    return { client, transport };
  }
  const { client } = await connect(root);
  async function call(name: string, args: Record<string, unknown> = {}, target = client): Promise<any> {
    const result = await target.callTool({ name, arguments: args });
    assert(!result.isError, JSON.stringify(result));
    const value = result.structuredContent as Record<string, unknown>;
    assert.equal(value['status'], 'ok');
    assert.deepEqual(JSON.parse((result.content as { text: string }[])[0]!.text), value);
    return value['data'];
  }
  function cli(...args: string[]): any {
    const result = spawnSync(process.execPath, [join(root, 'dist/src/cli/main.js'), ...args], { env: env(root), encoding: 'utf8', timeout: 4000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  const listed = (await client.listTools()).tools;
  assert.deepEqual(listed.map(t => t.name).sort(), ['context_read', 'context_write', 'journal', 'memory', 'note', 'projects',
    'sessions', 'task_create', 'task_list', 'task_show', 'task_update', 'warmup']);
  assert(listed.every(tool => tool.inputSchema.additionalProperties === false && tool.outputSchema));
  const readOnlyTools = ['warmup', 'task_list', 'task_show', 'journal', 'context_read', 'sessions'];
  for (const tool of listed) {
    const readonly = readOnlyTools.includes(tool.name);
    assert.equal(tool.annotations!.readOnlyHint, readonly, tool.name);
    assert.equal(tool.annotations!.destructiveHint, !readonly, tool.name);
  }
  assert.equal(listed.find(t => t.name === 'note')!.annotations!.idempotentHint, false);
  for (const [name, args] of [['memory', { action: 'add', text: 'missing scope' }], ['task_update', { key: 'MP-1' }], ['unknown', {}]] as const) {
    const invalid = await client.callTool({ name, arguments: args });
    assert.equal(invalid.isError, true);
    assert.equal((invalid.structuredContent as Record<string, unknown> | undefined)?.['status'], 'error');
    assert.deepEqual(JSON.parse((invalid.content as { text: string }[])[0]!.text), invalid.structuredContent);
  }
  for (const name of ['db_init', 'bootstrap', 'backup', 'backup_publish', 'restore', 'restore_published', 'journal_import',
    'status_list', 'status_add', 'status_rename', 'status_terminal', 'status_remove', 'context_restore', 'home_migrate_tasks']) {
    const absent = await client.callTool({ name, arguments: {} });
    assert.equal(absent.isError, true);
    assert.deepEqual(absent.structuredContent, { status: 'error', message: 'Unknown tool: ' + name });
  }
  assert.equal(existsSync(home), false);
  assert.equal(existsSync(root + '-state'), false, 'connect/list/invalid calls must not initialize DB');
  cli('db', 'init');
  await call('projects', { action: 'add', identity: 'one/project', code: 'MP', checkoutPath: dir });
  assert.equal((await call('projects', { action: 'update', identity: 'one/project', expectedCheckoutPath: dir, checkoutPath: root })).project.checkoutPath, root);
  assert.equal((await call('projects', { action: 'list', org: 'one' })).projects[0].code, 'MP');
  assert.equal((await call('projects', { action: 'resolve', path: root })).code, 'MP');
  cli('status', 'add', 'custom');
  cli('status', 'terminal', 'custom', 'true');
  cli('status', 'rename', 'custom', 'accepted');
  assert(cli('status', 'list').some((s: { code: string }) => s.code === 'accepted'));
  cli('status', 'add', 'unused'); cli('status', 'remove', 'unused');
  assert.equal(existsSync(home), false, 'DB-only tools must not depend on context');
  cli('bootstrap');
  const source = '\ufeff  original\r\nкириллица\n';
  const capture = await call('note', { kind: 'capture', source: { text: source } });
  assert.equal((await call('context_read', { path: capture.path })).text, source);
  const sourcePath = join(dir, 'source.txt'); writeFileSync(sourcePath, source);
  await call('memory', { action: 'add', scope: { type: 'global' }, text: 'parent fact' });
  await call('memory', { action: 'add', scope, text: 'project fact' });
  assert.equal((await call('memory', { action: 'show', scope })).items[0].text, 'project fact');
  await call('note', { kind: 'note', scope, title: 'Note', body: { file: sourcePath } });
  await call('note', { kind: 'error', project: 'one/project', text: 'real dead end' });
  await call('note', { kind: 'journal', scope, text: 'project outcome' });
  const warm: string = await call('warmup', { scope: 'MP' });
  assert(warm.startsWith('# mypi warmup: MP (one/project)\n'));
  assert(warm.includes('project fact') && !warm.includes('parent fact'), 'project warmup carries project memory, not global memory');
  assert(!warm.includes(capture.path), 'project warmup must not expose inbox');
  const task = await call('task_create', { project: 'one/project', title: 'Task', slug: 'task', status: 'new', source: { file: sourcePath } });
  assert.equal(task.key, 'MP-1');
  assert.equal(readFileSync(join(home, task.contextDir, 'source.md'), 'utf8'), source);
  await call('task_update', { key: task.key, title: 'Renamed', reason: 'clarified' });
  await call('task_update', { key: task.key, progress: 'proof saved', artifacts: [{ path: 'proof.md', text: 'proof' }] });
  assert.equal((await call('task_list', { project: 'one/project' }))[0].title, 'Renamed');
  writeFileSync(join(home, '.git/index.lock'), 'busy');
  await call('task_update', { key: task.key, status: 'accepted', reason: 'verified' });
  rmSync(join(home, '.git/index.lock'));
  assert.equal((await call('task_show', { key: task.key })).status, 'accepted');
  const history = await call('journal', { scope: { type: 'task', key: task.key }, eventType: 'status_changed' });
  assert.equal(history.length, 1);
  await call('task_update', { key: task.key, touch: true });
  await call('task_update', { key: task.key, status: 'accepted', reason: 'no-op' });
  assert.equal((await call('journal', { scope: { type: 'task', key: task.key }, eventType: 'status_changed' })).length, 1);
  const reopen = await client.callTool({ name: 'task_update', arguments: { key: task.key, status: 'new', reason: 'reopen' } });
  assert.equal(reopen.isError, true);
  assert.equal((reopen.structuredContent as Record<string, unknown>)['status'], 'error');
  const partial = await client.callTool({ name: 'task_update', arguments: { key: task.key, title: 'Partial', reason: 'partial check',
    progress: 'never saved', artifacts: [{ path: 'source.md' }] } });
  assert.equal(partial.isError, true);
  const { message, ...recovery } = partial.structuredContent as Record<string, unknown>;
  assert.deepEqual(recovery, { status: 'partial', saved: ['title'], missing: ['progress'], paths: [task.contextDir], taskId: task.id });
  assert.match(String(message), /task_update stopped at progress after saving title: .*Invalid artifact set/);
  const partialCard = await call('task_show', { key: task.key });
  assert.equal(partialCard.title, 'Partial'); assert.equal(partialCard.status, 'accepted');
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-C', home, ...args], { encoding: 'utf8', timeout: 4000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  const revision = git('rev-parse', 'HEAD');
  const beforeRemoval = await call('memory', { action: 'show', scope });
  for (const args of [{ action: 'remove', scope, number: 1 }, { action: 'remove', scope, number: 1, expectedRevision: '0'.repeat(64) }]) {
    const rejected = await client.callTool({ name: 'memory', arguments: args });
    assert.equal(rejected.isError, true);
    assert.deepEqual(await call('memory', { action: 'show', scope }), beforeRemoval);
  }
  await call('memory', { action: 'remove', scope, number: 1, expectedRevision: beforeRemoval.revision });
  cli('context', 'restore', 'projects/one/project/MEMORY.md', '--revision', revision);
  assert.equal((await call('memory', { action: 'show', scope })).items[0].text, 'project fact');
  const second = (await connect(root)).client;
  await Promise.all(['concurrent A', 'concurrent B'].map(text => call('memory', { action: 'add', scope, text })));
  assert.deepEqual((await call('memory', { action: 'show', scope })).items.map((item: { text: string }) => item.text),
    ['project fact', 'concurrent A', 'concurrent B']);
  // Send calls from two independent MCP processes and a real CLI writer.
  const child = spawn(process.execPath, [join(root, 'dist/src/cli/main.js'), 'task', 'create', 'cli source',
    '--title', 'CLI', '--slug', 'cli', '--status', 'new', '--project', 'one/project'], { env: env(root) });
  let cliOut = '', cliError = '';
  child.stdout.on('data', b => { cliOut += String(b); }); child.stderr.on('data', b => { cliError += String(b); });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = once(child, 'exit');
  const cards = await Promise.all([client, second].map((target, i) => call('task_create', {
    project: 'one/project', title: 'Concurrent', slug: 'concurrent-' + i, status: 'new', source: { text: 'source ' + i },
  }, target)));
  const [code] = await exited; assert.equal(code, 0, cliError);
  assert.deepEqual([...cards.map(c => c.number), JSON.parse(cliOut).number].sort(), [2, 3, 4]);
  const committed = await call('context_write', { paths: [task.contextDir + '/source.md', task.contextDir + '/proof.md',
    ...cards.map(c => c.contextDir + '/source.md'), 'projects/one/project/tasks/MP-' + JSON.parse(cliOut).number + '-cli/source.md'], message: 'Publish local files for backup' });
  assert.match(committed.commit, /^[0-9a-f]{40}$/);
});

test('stdio EOF and SIGTERM exit cleanly without creating state', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-mcp-exit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const mode of ['eof', 'signal']) {
    const child = spawn(process.execPath, ['/work/dist/src/mcp/main.js'], {
      env: { PATH: '/work/tools:/usr/bin', HOME: dir, XDG_STATE_HOME: join(dir, 'state') },
    });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    const exit = once(child, 'exit'); let output = '', errors = '';
    child.stdout.on('data', b => { output += String(b); }); child.stderr.on('data', b => { errors += String(b); });
    const ready = once(child.stdout, 'data');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n');
    await ready; assert.equal(JSON.parse(output).id, 1);
    if (mode === 'eof') child.stdin.end(); else child.kill('SIGTERM');
    const [code, signal] = await exit;
    assert.equal(code, 0); assert.equal(signal, null); assert.equal(errors, '');
    assert.equal(existsSync(join(dir, 'state')), false);
  }
});
