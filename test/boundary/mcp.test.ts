import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { encodePiContext, MYPI_MCP_CONTEXT } from '../../src/app/pi-context.js';
import { configureHome, homeGit } from '../support/home.js';

test('real stdio: discovery without initialization, all tools, exact source, scope, partial reconciliation, two clients/CLI and restore', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-mcp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  function install(name: string) {
    const root = join(dir, name); mkdirSync(root);
    cpSync('/work/dist', join(root, 'dist'), { recursive: true });
    symlinkSync('/work/node_modules', join(root, 'node_modules'));
    return root;
  }
  const root = install('engine'), home = join(root, 'home'), scope = { type: 'project', key: 'MP' };
  const env = (where: string) => ({ PATH: '/work/tools:/usr/bin', HOME: join(dir, 'user'), XDG_STATE_HOME: where + '-state',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });
  async function connect(where: string, extraEnv: Record<string, string> = {}) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(where, 'dist/src/mcp/main.js')],
      cwd: dir, env: { ...env(where), ...extraEnv }, stderr: 'pipe' });
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
  const listed = (await client.listTools()).tools;
  assert.equal(listed.length, 43);
  for (const name of ['session_list', 'session_show', 'session_archive']) {
    const annotations = listed.find(tool => tool.name === name)!.annotations!;
    assert.equal(annotations.readOnlyHint, name !== 'session_archive');
    assert.equal(annotations.idempotentHint, true);
    assert.equal(annotations.destructiveHint, false);
    assert.equal(annotations.openWorldHint, false);
  }
  assert.deepEqual(await call('session_list', { all: true }), { sessions: [], issues: [], truncated: false });
  assert.deepEqual(await call('session_show', { all: true, instanceKey: '11111111-1111-4111-8111-111111111111' }), { session: null, issue: 'missing' });
  for (const name of ['home_document_patch', 'home_status', 'home_reconcile']) {
    const annotations = listed.find(tool => tool.name === name)!.annotations!;
    assert.equal(annotations.openWorldHint, true);
    assert.equal(annotations.readOnlyHint, name === 'home_status');
    assert.equal(annotations.idempotentHint, name === 'home_status');
  }
  assert(listed.every(tool => tool.inputSchema.additionalProperties === false && tool.outputSchema));
  assert.equal(listed.find(t => t.name === 'backup')!.annotations!.readOnlyHint, false);
  assert.equal(listed.find(t => t.name === 'journal_add')!.annotations!.idempotentHint, false);
  assert.equal(listed.find(t => t.name === 'journal_add')!.annotations!.openWorldHint, true);
  assert.equal(listed.find(t => t.name === 'request_create')!.annotations!.openWorldHint, true);
  assert.equal(listed.find(t => t.name === 'request_touch')!.annotations!.openWorldHint, false);
  for (const [name, args] of [['memory_add', { text: 'missing scope' }], ['db_init', { unknown: 1 }], ['unknown', {}]] as const) {
    const invalid = await client.callTool({ name, arguments: args });
    assert.equal(invalid.isError, true);
    assert.equal((invalid.structuredContent as Record<string, unknown> | undefined)?.['status'], 'error');
    assert.deepEqual(JSON.parse((invalid.content as { text: string }[])[0]!.text), invalid.structuredContent);
  }
  assert.equal(existsSync(home), false);
  assert.equal(existsSync(root + '-state'), false, 'connect/list/invalid calls must not initialize DB');
  await call('db_init');
  await call('project_add', { identity: 'one/project', code: 'MP', checkoutPath: dir });
  assert.equal((await call('project_list', { org: 'one' })).projects[0].code, 'MP');
  assert.equal((await call('project_resolve', { path: root })).code, 'MP');
  await call('status_add', { code: 'custom', terminal: false });
  assert.equal(existsSync(home), false, 'DB-only tools must not depend on context');
  await call('status_terminal', { code: 'custom', terminal: true });
  await call('status_rename', { code: 'custom', newCode: 'accepted' });
  assert((await call('status_list')).some((s: { code: string }) => s.code === 'accepted'));
  await call('status_add', { code: 'unused', terminal: false }); await call('status_remove', { code: 'unused' });
  await call('bootstrap');
  configureHome(home);
  const source = '\ufeff  original\r\nкириллица\n';
  const capture = await call('capture', { source: { text: source } });
  assert.equal((await call('context_read', { path: capture.path })).text, source);
  const sourcePath = join(dir, 'source.txt'); writeFileSync(sourcePath, source);
  await call('memory_add', { scope: { type: 'global' }, text: 'parent fact' });
  await call('memory_add', { scope, text: 'project fact' });
  assert.equal((await call('memory_show', { scope })).items[0].text, 'project fact');
  await call('note_add', { scope, title: 'Note', body: { file: sourcePath } });
  await call('error_add', { project: 'one/project', text: 'real dead end' });
  await call('journal_add', { scope, text: 'project outcome' });
  const warm = JSON.stringify(await call('warmup', { scope }));
  assert(warm.includes('parent fact') && warm.includes('project fact'));
  assert(!warm.includes(capture.path), 'project warmup must not expose inbox');
  const request = await call('request_create', { project: 'one/project', title: 'Task', slug: 'task', status: 'new', source: { file: sourcePath } });
  assert.equal(request.key, 'MP-1');
  assert.equal(readFileSync(join(home, request.contextDir, 'source.md'), 'utf8'), source);
  const contextEnv = { [MYPI_MCP_CONTEXT]: encodePiContext({ version: 1, cwd: dir,
    context: { scope: { kind: 'project', project: 'one/project' } } }) };
  const contextual = (await connect(root, contextEnv)).client;
  assert.deepEqual((await call('request_list', {}, contextual)).map((card: { key: string }) => card.key), ['MP-1']);
  const blocked = await contextual.callTool({ name: 'memory_add', arguments: { scope: { type: 'global' }, text: 'forbidden' } });
  assert.equal(blocked.isError, true);
  assert.match(String((blocked.structuredContent as Record<string, unknown>)['message']), /outside the working selection/);
  assert.deepEqual((await call('memory_show', { scope: { type: 'global' } })).items.map((item: { text: string }) => item.text), ['parent fact']);
  await contextual.close();
  const selectedPolicy = join(dir, 'policy.yaml');
  writeFileSync(selectedPolicy, 'version: 2\nguards: {foreignMypiTarget: warn}\n');
  const warningClient = (await connect(root, { ...contextEnv, MYPI_GUARD_POLICY: selectedPolicy })).client;
  writeFileSync(selectedPolicy, 'invalid policy'); // Existing consumer retains its load-once selection.
  const warning = await call('memory_add', { scope: { type: 'global' }, text: 'warned global fact' }, warningClient);
  assert.deepEqual(warning.data, { path: 'MEMORY.md' });
  assert.equal(warning.warnings.length, 1);
  assert.equal(warning.warnings[0].behavior, 'warn'); assert.equal(warning.warnings[0].guard, 'foreignMypiTarget');
  assert.equal((await call('memory_show', { scope: { type: 'global' } })).items[1].text, 'warned global fact');
  await warningClient.close();
  const badPolicy = (await connect(root, { ...contextEnv, MYPI_GUARD_POLICY: selectedPolicy })).client;
  assert.equal((await badPolicy.listTools()).tools.length, 43);
  assert.deepEqual(await call('session_list', {}, badPolicy), { sessions: [], issues: [], truncated: false }, 'cache routes bypass registry/policy membership');
  assert((await call('status_list', {}, badPolicy)).length > 0);
  const invalidPolicy = await badPolicy.callTool({ name: 'project_list', arguments: {} });
  assert.equal(invalidPolicy.isError, true);
  assert.match(String((invalidPolicy.structuredContent as Record<string, unknown>)['message']), /Invalid guard policy/);
  assert.equal((await call('context_read', { path: 'MEMORY.md' }, badPolicy)).text.includes('warned global fact'), true);
  await badPolicy.close();
  await call('request_title', { key: request.key, title: 'Renamed', reason: 'clarified' });
  await call('request_progress', { key: request.key, text: 'proof saved', artifacts: [{ path: 'proof.md', text: 'proof' }] });
  assert.equal((await call('request_list', { project: 'one/project' }))[0].title, 'Renamed');
  writeFileSync(join(home, '.git/index.lock'), 'busy');
  const partial = await client.callTool({ name: 'request_status', arguments: { key: request.key, status: 'accepted', reason: 'verified' } });
  assert.equal(partial.isError, true);
  const recovery = partial.structuredContent as Record<string, unknown>;
  assert.deepEqual(recovery, { status: 'partial', message: recovery['message'], saved: ['database'],
    missing: ['inspect journal', 'git'], paths: [request.contextDir], requestId: request.id, home: recovery['home'] });
  assert.equal((recovery['home'] as { needsAttention: boolean }).needsAttention, true);
  assert.deepEqual(JSON.parse((partial.content as { text: string }[])[0]!.text), recovery);
  assert.match(String(recovery['message']), /index.lock/);
  rmSync(join(home, '.git/index.lock'));
  assert.equal((await call('request_show', { key: request.key })).status, 'accepted');
  const history = await call('journal_read', { scope: { type: 'request', key: request.key }, eventType: 'status_changed' });
  assert.equal(history.length, 1);
  const log = 'journal/' + history[0].at.slice(0, 7) + '.jsonl', before = readFileSync(join(home, log));
  await call('context_commit', { paths: [log], message: 'complete inspected partial' });
  await call('request_touch', { key: request.key });
  assert.deepEqual(readFileSync(join(home, log)), before);
  const blockedPending = await client.callTool({ name: 'request_status', arguments: { key: request.key, status: 'accepted', reason: 'no-op' } });
  assert.equal(blockedPending.isError, true);
  assert.match(String((blockedPending.structuredContent as Record<string, unknown>)['message']), /Pending home operation/);
  // Explicit fixture-operator disposition after verifying DB and journal; raw
  // maintenance neither auto-publishes nor implicitly clears pending state.
  homeGit(home, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
  rmSync(join(home, '.git/mypi-home-pending.json'));
  await call('request_status', { key: request.key, status: 'accepted', reason: 'no-op' });
  assert.deepEqual(readFileSync(join(home, log)), before);
  assert.equal((await client.callTool({ name: 'request_status', arguments: { key: request.key, status: 'new', reason: 'reopen' } })).isError, true);
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-C', home, ...args], { encoding: 'utf8', timeout: 4000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  const revision = git('rev-parse', 'HEAD');
  await call('memory_remove', { scope, number: 1 });
  await call('context_restore', { path: 'projects/one/project/MEMORY.md', revision });
  assert.equal((await call('memory_show', { scope })).items[0].text, 'project fact');
  homeGit(home, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main'); // Explicit maintenance restore publication.
  const second = (await connect(root)).client;
  // Send requests from two independent MCP processes and a real CLI writer.
  const child = spawn(process.execPath, [join(root, 'dist/src/cli/main.js'), 'request', 'create', 'cli source',
    '--title', 'CLI', '--slug', 'cli', '--status', 'new', '--project', 'one/project'], { env: env(root) });
  let cliOut = '', cliError = '';
  child.stdout.on('data', b => { cliOut += String(b); }); child.stderr.on('data', b => { cliError += String(b); });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = once(child, 'exit');
  const cards = await Promise.all([client, second].map((target, i) => call('request_create', {
    project: 'one/project', title: 'Concurrent', slug: 'concurrent-' + i, status: 'new', source: { text: 'source ' + i },
  }, target)));
  const [code] = await exited; assert.equal(code, 0, cliError);
  assert.deepEqual([...cards.map(c => c.number), JSON.parse(cliOut).number].sort(), [2, 3, 4]);
  // Backup holds an async reservation: a queued write in this process must wait, not self-deadlock.
  const snapshot = join(dir, 'snapshot');
  await Promise.all([call('backup', { destination: snapshot }), call('journal_add', { scope, text: 'after snapshot' })]);
  const restored = install('restored'), restoredClient = (await connect(restored)).client;
  await call('restore', { backupDirectory: snapshot }, restoredClient);
  assert.equal((await call('request_show', { key: request.key }, restoredClient)).status, 'accepted');
  assert.equal((await restoredClient.callTool({ name: 'restore', arguments: { backupDirectory: snapshot } })).isError, true);
});

test('stdio context envelope, EOF and SIGTERM preserve startup and no-state behavior', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-mcp-exit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const mode of ['eof', 'signal', 'invalid-context']) {
    const context = encodePiContext({ version: 1, cwd: dir, context: { scope: { kind: 'project', project: 'one/project' } } });
    const child = spawn(process.execPath, ['/work/dist/src/mcp/main.js'], {
      env: { PATH: '/work/tools:/usr/bin', HOME: dir, XDG_STATE_HOME: join(dir, 'state'),
        ...(mode === 'eof' ? {} : { [MYPI_MCP_CONTEXT]: mode === 'signal' ? context : 'malformed' }) },
    });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    const exit = once(child, 'exit'); let output = '', errors = '';
    child.stdout.on('data', b => { output += String(b); }); child.stderr.on('data', b => { errors += String(b); });
    if (mode === 'invalid-context') {
      const [code, signal] = await exit;
      assert.equal(code, 1); assert.equal(signal, null); assert.equal(output, '');
      assert.equal(errors, 'mypi MCP startup failed; check installation and state path.\n');
      assert.equal(existsSync(join(dir, 'state')), false);
      continue;
    }
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
