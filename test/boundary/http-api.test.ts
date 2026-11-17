import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { AppCommand } from '../../src/app/commands.js';
import { executeCommand } from '../../src/app/execute-command.js';
import { remoteBackend } from '../../src/app/backend.js';
import type { Backend } from '../../src/app/backend.js';
import { contextGit } from '../../src/infrastructure/git/context-git.js';
import { PartialError } from '../../src/shared/context.js';
import { InputError } from '../../src/shared/errors.js';

test('real mypi serve on loopback: bearer auth, read paging with a cursor, write permission, changeId and SSE after a write, access log without secrets, the built web UI and a read-only browser session cookie, and MCP JSON-RPC on /mcp', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mypi-http-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = '/work/dist/src/cli/main.js';
  const runtime = join(dir, 'run');
  mkdirSync(runtime, { mode: 0o700 });
  const env = { PATH: '/work/tools:/usr/bin', HOME: dir, XDG_STATE_HOME: join(dir, 'state'), XDG_CONFIG_HOME: join(dir, 'config'),
    XDG_RUNTIME_DIR: runtime, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig') };
  const run = (args: string[], extra: Record<string, string> = {}) => {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 5000 });
    assert.ifError(result.error);
    return result;
  };
  for (const args of [['db', 'init'], ['project', 'add', 'fx/one', '--code', 'FX', '--repository', 'file:///nonexistent/fx/one.git']]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
  }
  const empty = run(['serve', '--port', '0'], { XDG_CONFIG_HOME: join(dir, 'empty-config') });
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /No API tokens/);
  const token = (name: string, permission: string) => {
    const result = run(['token', 'create', name, '--permission', permission]);
    assert.equal(result.status, 0, result.stderr);
    return (JSON.parse(result.stdout) as { token: string }).token;
  };
  const reader = token('reader', 'read'), writer = token('writer', 'write'), viewer = token('viewer', 'read');
  const laptopToken = token('laptop', 'device'), phoneToken = token('phone', 'device');

  const child = spawn(process.execPath, [entry, 'serve', '--port', '0'], { env, cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid!, 'SIGKILL'); });
  let stdout = '', stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
  const url = await new Promise<string>((resolve, reject) => {
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      const line = stdout.split('\n')[0];
      if (stdout.includes('\n')) resolve((JSON.parse(line!) as { url: string }).url);
    });
    child.once('exit', code => reject(new Error('serve exited ' + code + ': ' + stderr)));
  });
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const auth = (value: string) => ({ authorization: 'Bearer ' + value });
  const get = async (path: string, value = reader) => {
    const response = await fetch(url + path, { headers: auth(value) });
    return { status: response.status, body: await response.json() as { data: never; error: { code: string } } };
  };
  const post = async (path: string, value: string, body: unknown) => {
    const response = await fetch(url + path, { method: 'POST', headers: { ...auth(value), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { data: { id: number }; error: { code: string } } };
  };

  assert.equal((await fetch(url + '/v1/info')).status, 401);
  assert.equal((await fetch(url + '/v1/info', { headers: auth('nope') })).status, 401);
  const info = await get('/v1/info');
  assert.equal(info.status, 200);
  const version = (JSON.parse(readFileSync('/work/package.json', 'utf8')) as { version: string }).version;
  const { schemaVersion, version: served, changeId: c0 } = info.body.data as { schemaVersion: number; version: string; changeId: number };
  assert.deepEqual([schemaVersion, served], [17, version]);

  const page = await fetch(url + '/');
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /^text\/html/);
  assert.ok(html.includes('<div id="root"></div>'));
  const script = /\/assets\/[^"]+\.js/.exec(html)?.[0];
  assert.ok(script !== undefined);
  const asset = await fetch(url + script);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') ?? '', /^text\/javascript/);
  await asset.arrayBuffer();
  assert.equal(await (await fetch(url + '/tasks')).text(), html);

  const login = async (value: string, extra: Record<string, string> = {}) => {
    const response = await fetch(url + '/v1/session', { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify({ token: value }) });
    assert.equal(response.status, 200);
    await response.json();
    return response.headers.get('set-cookie') ?? '';
  };
  const session = await login(reader);
  assert.match(session, /HttpOnly/);
  assert.match(session, /SameSite=Strict/);
  assert.doesNotMatch(session, /Secure/);
  assert.match(await login(reader, { 'x-forwarded-proto': 'https' }), /; Secure/);
  const pair = (header: string) => ({ cookie: header.split(';')[0]! });
  const readerCookie = pair(session), writerCookie = pair(await login(writer)), viewerCookie = pair(await login(viewer));
  assert.equal((await fetch(url + '/v1/info', { headers: readerCookie })).status, 200);
  const cookieWrite = await fetch(url + '/v1/messages', { method: 'POST', headers: { ...writerCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ to: 'FX', text: 'x' }) });
  assert.deepEqual([cookieWrite.status, ((await cookieWrite.json()) as { error: { code: string } }).error.code], [403, 'forbidden']);

  const controller = new AbortController();
  const changes = async (headers: Record<string, string>) => {
    const sse = await fetch(url + '/v1/changes', { headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
    assert.equal(sse.status, 200);
    const stream = sse.body!.getReader(), decoder = new TextDecoder();
    let buffer = '';
    return async () => {
      for (;;) {
        const match = /data: (\{[^\n]*\})\n\n/.exec(buffer);
        if (match) { buffer = buffer.slice(match.index + match[0].length); return (JSON.parse(match[1]!) as { changeId: number }).changeId; }
        const { value, done } = await stream.read();
        if (done) throw new Error('SSE ended');
        buffer += decoder.decode(value, { stream: true });
      }
    };
  };
  const nextChange = await changes(auth(reader)), nextViewed = await changes(auth(viewer)), nextCookie = await changes(readerCookie);
  assert.equal(await nextChange(), c0);
  assert.equal(await nextViewed(), c0);
  assert.equal(await nextCookie(), c0);

  const refused = await post('/v1/messages', reader, { to: 'FX', text: 'один' });
  assert.deepEqual([refused.status, refused.body.error.code], [403, 'forbidden']);
  for (const text of ['один', 'два']) {
    const sent = await post('/v1/messages', writer, { to: 'FX', text });
    assert.equal(sent.status, 201);
    assert.equal(typeof sent.body.data.id, 'number');
  }
  const revoked = run(['token', 'revoke', 'viewer']);
  assert.equal(revoked.status, 0, revoked.stderr);
  const started = Date.now();
  assert.ok(await nextChange() > c0);
  assert.ok(await nextCookie() > c0);
  await assert.rejects(nextViewed(), /SSE ended/);
  assert.equal((await get('/v1/info', viewer)).status, 401);
  const stale = await fetch(url + '/v1/info', { headers: viewerCookie });
  assert.equal(stale.status, 401);
  assert.match(stale.headers.get('set-cookie') ?? '', /Max-Age=0/);
  await stale.json();
  assert.ok(Date.now() - started < 5000);
  assert.ok((await get('/v1/info')).body.data['changeId'] > c0);

  const first = await get('/v1/events?to=FX&limit=1');
  const { items, next } = first.body.data as { items: { text: string; from: string }[]; next: string };
  assert.deepEqual(items.map(e => [e.text, e.from]), [['два', 'global']]);
  assert.equal(typeof next, 'string');
  const second = (await get('/v1/events?to=FX&limit=1&cursor=' + next)).body.data as { items: { text: string }[]; next: null };
  assert.deepEqual([second.items.map(e => e.text), second.next], [['один'], null]);
  controller.abort();

  const rpc = async (value: string | undefined, body: unknown, method = 'POST') => {
    const response = await fetch(url + '/mcp', { method, headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json',
      ...(value === undefined ? {} : auth(value)) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
    return { response, body: await response.json() as { result: never } };
  };
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'boundary', version: '1' } } };
  const call = async (value: string, name: string, args: unknown) =>
    (await rpc(value, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } })).body.result as
      { isError?: boolean; structuredContent: { status: string; message: string; data: unknown } };
  const anonymous = await rpc(undefined, initialize);
  assert.equal(anonymous.response.status, 401);
  assert.match(anonymous.response.headers.get('www-authenticate') ?? '', /^Bearer/);
  assert.equal((await rpc(reader, undefined, 'GET')).response.status, 405);
  const initialized = await rpc(reader, initialize);
  assert.equal(initialized.response.status, 200);
  const { serverInfo } = initialized.body.result as { serverInfo: { name: string; version: string } };
  assert.deepEqual([serverInfo.name, serverInfo.version], ['mypi', version]);
  assert.equal(initialized.response.headers.get('mcp-session-id'), null);
  const names = async (value: string) => ((await rpc(value, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).body.result as { tools: unknown[] }).tools.length;
  assert.deepEqual([await names(reader), await names(writer)], [5, 9]);
  const remoteTask = { project: 'fx/one', title: 'Удалённая', status: 'new', slug: 'remote', source: { text: 'с другой машины' } };
  const readOnly = await call(reader, 'task_create', remoteTask);
  assert.deepEqual([readOnly.isError, readOnly.structuredContent.message], [true, 'This token is read-only']);
  assert.equal((await call(writer, 'task_create', { ...remoteTask, source: { file: '/etc/hostname' } })).isError, true);
  assert.equal(((await call(reader, 'task_list', {})).structuredContent.data as unknown as unknown[]).length, 0);
  const fx = { type: 'project', key: 'FX' };
  assert.equal((await call(writer, 'note', { kind: 'journal', scope: fx, text: 'Удалённая' })).structuredContent.status, 'ok');
  assert.match(JSON.stringify((await call(reader, 'journal', { scope: fx })).structuredContent.data), /Удалённая/);

  const device = (name: string, value: string) => {
    const config = join(dir, name + '-config');
    mkdirSync(join(config, 'mypi'), { recursive: true });
    writeFileSync(join(config, 'mypi', 'server.json'), JSON.stringify({ url, token: value }), { mode: 0o600 });
    return { ...env, XDG_CONFIG_HOME: config, XDG_STATE_HOME: join(dir, name + '-state') };
  };
  const laptop = device('laptop', laptopToken), phone = device('phone', phoneToken);
  mkdirSync(join(dir, 'device-clone'));
  symlinkSync(join(dir, 'device-clone'), join(dir, 'device-link'));
  const added = run(['project', 'add', 'fx/two', '--code', 'FXT', '--path', join(dir, 'device-link'), '--repository', 'file:///nonexistent/fx/two.git'], laptop);
  assert.equal(added.status, 0, added.stderr);
  assert.equal((JSON.parse(added.stdout) as { project: { checkoutPath: string } }).project.checkoutPath, realpathSync(join(dir, 'device-clone')));
  const listed = run(['task', 'list'], laptop);
  assert.deepEqual([listed.status, listed.stdout], [0, '[]\n'], listed.stderr);
  assert.equal(existsSync(join(dir, 'laptop-state')), false);
  const spawned = (args: string[], extra: Record<string, string>) => new Promise<number | null>((resolve, reject) => {
    const cli = spawn(process.execPath, [entry, ...args], { env: extra, cwd: dir, stdio: 'ignore' });
    cli.once('error', reject);
    cli.once('exit', code => resolve(code));
  });
  assert.deepEqual(await Promise.all([
    spawned(['project', 'add', 'fx/three', '--code', 'FXC', '--repository', 'file:///nonexistent/fx/three.git'], laptop),
    spawned(['project', 'add', 'fx/four', '--code', 'FXD', '--repository', 'file:///nonexistent/fx/four.git'], phone),
  ]), [0, 0]);
  const projects = run(['project', 'list'], phone);
  assert.equal(projects.status, 0, projects.stderr);
  assert.deepEqual((JSON.parse(projects.stdout) as { projects: { code: string }[] }).projects.map(p => p.code).sort(), ['FX', 'FXC', 'FXD', 'FXT']);
  const remoteInit = run(['db', 'init'], laptop);
  assert.equal(remoteInit.status, 1);
  assert.match(remoteInit.stderr, /db_init is not available in remote mode/);
  const remoteServe = run(['serve', '--port', '0'], laptop);
  assert.equal(remoteServe.status, 1);
  assert.match(remoteServe.stderr, /serve is not available in remote mode/);
  const operation = { op: 'project_list', input: {}, version };
  for (const value of [reader, writer]) {
    const refusedOperation = await post('/v1/ops', value, operation);
    assert.deepEqual([refusedOperation.status, refusedOperation.body.error.code], [403, 'forbidden']);
  }
  const mismatch = await post('/v1/ops', laptopToken, { ...operation, version: '0.0.0' });
  assert.deepEqual([mismatch.status, mismatch.body.error.code], [409, 'version_mismatch']);
  const cookieOperation = await fetch(url + '/v1/ops', { method: 'POST', headers: { ...pair(await login(laptopToken)), 'content-type': 'application/json' },
    body: JSON.stringify(operation) });
  assert.equal(cookieOperation.status, 403);
  await cookieOperation.json();
  assert.equal(await names(laptopToken), 5);
  const transport = new StdioClientTransport({ command: process.execPath, args: ['/work/dist/src/mcp/main.js'], cwd: dir, env: laptop, stderr: 'ignore' });
  const client = new Client({ name: 'device', version: '1' });
  await client.connect(transport);
  try {
    const remoteProjects = await client.callTool({ name: 'projects', arguments: { action: 'list' } });
    assert.equal((remoteProjects.structuredContent as { status: string }).status, 'ok');
    assert.match(JSON.stringify(remoteProjects.structuredContent), /"FXT"/);
    const remoteSessions = await client.callTool({ name: 'sessions', arguments: {} });
    assert.equal(remoteSessions.isError, true);
    assert.match(JSON.stringify(remoteSessions.structuredContent), /not available in remote mode/);
  } finally { await client.close(); }

  const deviceRoot = join(dir, 'laptop-home');
  contextGit(deviceRoot).initialize();
  const unused = join(dir, 'laptop-unused', 'state.sqlite3');
  const remote = remoteBackend({ url, token: laptopToken });
  const deviceRun = (c: AppCommand, backend: Backend = remote) => executeCommand(c, unused, deviceRoot, {}, {}, backend);
  const head = () => spawnSync('git', ['-C', deviceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const lastSubject = () => spawnSync('git', ['-C', deviceRoot, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).stdout.trim();
  const remoteSource = { name: 'task_create', project: 'fx/two', title: 'Remote', status: 'new', slug: 'remote', source: { text: 'remote source' } } as const;
  const created = await deviceRun(remoteSource) as { key: string; contextDir: string };
  assert.equal(created.key, 'FXT-1');
  assert.equal(readFileSync(join(deviceRoot, created.contextDir, 'source.md'), 'utf8'), 'remote source');
  assert.equal((await deviceRun({ name: 'task_show', key: 'FXT-1' }) as { title: string }).title, 'Remote');
  const taskJournal = async () => await deviceRun({ name: 'journal_read', scope: { type: 'task', key: 'FXT-1' } }) as
    { event_type: string; text: string; artifacts?: unknown[] }[];
  assert.equal((await taskJournal()).at(-1)!.event_type, 'task_created');
  await assert.rejects(deviceRun({ ...remoteSource, slug: 'adopted', adoptSource: true }),
    (error: unknown) => error instanceof InputError && error.message === 'adopt-source is not available in remote mode');
  assert.equal((await deviceRun({ name: 'task_list', project: 'fx/two' }) as unknown[]).length, 1);
  await deviceRun({ name: 'task_progress', key: 'FXT-1', text: 'plan', artifacts: [{ path: 'plan.md', text: 'v1' }] });
  assert.equal(readFileSync(join(deviceRoot, created.contextDir, 'plan.md'), 'utf8'), 'v1');
  const planned = (await taskJournal()).at(-1)!;
  assert.deepEqual([planned.text, planned.artifacts], ['plan', [{ path: created.contextDir + '/plan.md', commit: head() }]]);
  assert.equal((await deviceRun({ name: 'task_status', key: 'FXT-1', status: 'review', reason: 'ready' }) as { status: string }).status, 'review');
  const milestones = async () => (await deviceRun({ name: 'event_list', from: 'FXT-1', kind: 'milestone', limit: 10 }) as { items: { toKey: string }[] }).items;
  assert.deepEqual((await milestones()).map(e => e.toKey), ['FXT']);
  assert.equal((await deviceRun({ name: 'task_status', key: 'FXT-1', status: 'blocked', reason: 'wait', envScope: 'FXT' }) as { status: string }).status, 'blocked');
  assert.equal((await milestones()).length, 1);
  const note = await deviceRun({ name: 'note_add', scope: { reference: 'fx/two' }, title: 'Remote note', body: { text: 'body' } }) as { path: string };
  assert.ok(note.path.startsWith('projects/fx/two/notes/'), note.path);
  assert.ok(existsSync(join(deviceRoot, note.path)));
  assert.equal(lastSubject(), 'Create ' + note.path);
  const failing: Backend = { remote: true, run: (name, input) => name === 'task_progress'
    ? Promise.reject(new Error('mypi server unreachable: ' + url)) : remote.run(name, input) };
  await assert.rejects(deviceRun({ name: 'task_progress', key: 'FXT-1', text: 'second', artifacts: [{ path: 'review.md', text: 'r1' }] }, failing),
    (error: unknown) => error instanceof PartialError && JSON.stringify([error.saved, error.missing, error.paths])
      === JSON.stringify([['artifacts', 'git'], ['journal', 'activity timestamp'], [created.contextDir + '/review.md']]));
  assert.equal(lastSubject(), 'Register artifacts of FXT-1');
  assert.equal((await taskJournal()).some(e => e.text === 'second'), false);
  const committed = head();
  await deviceRun({ name: 'task_progress', key: 'FXT-1', text: 'second', artifacts: [{ path: 'review.md' }] });
  assert.equal(head(), committed);
  assert.deepEqual((await taskJournal()).at(-1)!.artifacts, [{ path: created.contextDir + '/review.md', commit: head() }]);
  assert.equal(existsSync(join(dir, 'laptop-unused')), false);

  process.kill(-child.pid!, 'SIGINT');
  assert.equal(await exited, 0);
  assert.match(stderr, / \/v1\/messages 403 reader/);
  assert.match(stderr, / \/v1\/messages 201 writer/);
  assert.match(stderr, / \/ 200 -/);
  assert.match(stderr, / \/v1\/session 200 reader/);
  assert.match(stderr, / \/mcp 401 -/);
  assert.match(stderr, / \/mcp 405 reader/);
  assert.match(stderr, / \/mcp 200 writer/);
  assert.match(stderr, / \/v1\/ops 200 laptop/);
  assert.match(stderr, / \/v1\/ops 403 reader/);
  for (const secret of [reader, writer, viewer, laptopToken, phoneToken, 'один', 'два', 'Удалённая', 'с другой машины', 'remote source']) assert.equal(stderr.includes(secret), false, secret);
});
