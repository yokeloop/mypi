import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppCommand } from '../../src/app/commands.js';
import { remoteTools, remoteToolNames, remoteToolCommand } from '../../src/mcp/remote-tools.js';
import type { RemoteToken } from '../../src/mcp/remote-tools.js';
import { toolCommand } from '../../src/mcp/tools.js';
import { tasks } from '../../src/mcp/tools/tasks.js';
import { knowledge } from '../../src/mcp/tools/knowledge.js';
import { sessionTools } from '../../src/mcp/tools/sessions.js';
import { createRemoteMcp } from '../../src/mcp/remote.js';

const reader: RemoteToken = { name: 'reader', permission: 'read', sender: null };
const writer: RemoteToken = { name: 'writer', permission: 'write', sender: 'global' };
const projectWriter: RemoteToken = { name: 'mp', permission: 'write', sender: 'MP' };
const g = { type: 'global' };
const readNames = ['context_read', 'journal', 'projects', 'task_list', 'task_show'];

test('remote MCP offers five read tools to read tokens and nine to write tokens; local-only tools are unknown', () => {
  assert.deepEqual(remoteToolNames('read').sort(), readNames);
  assert.deepEqual(remoteToolNames('write').sort(), [...readNames, 'note', 'send_message', 'task_create', 'task_update'].sort());
  for (const name of ['open_session', 'sessions', 'inbox', 'warmup', 'memory', 'context_write', 'capture', 'note_add',
    'project_add', 'db_init', 'backup', '__proto__']) {
    assert.throws(() => remoteToolCommand(name, {}, writer, undefined), /Unknown tool/, name);
  }
  for (const name of ['task_create', 'note', 'send_message', 'task_update']) {
    assert.throws(() => remoteToolCommand(name, {}, reader, '/run/u'), /This token is read-only/, name);
  }
});

test('remote tools reuse local definitions, translate like the local server and take the sender from the token', () => {
  assert.equal(remoteTools.task_list, tasks.task_list);
  assert.equal(remoteTools.task_show, tasks.task_show);
  assert.equal(remoteTools.journal, knowledge.journal);
  assert.equal(remoteTools.context_read, knowledge.context_read);
  assert.equal(remoteTools.send_message.schema, sessionTools.send_message.schema);
  const rows: [string, unknown][] = [
    ['task_list', { project: 'one/project', status: 'new' }],
    ['task_show', { key: 'MP-1' }],
    ['journal', { scope: 'all', limit: 2 }],
    ['context_read', { path: 'projects/one/project/README.md' }],
    ['projects', { action: 'list', org: 'one' }],
    ['projects', { action: 'flow', project: 'MP' }],
    ['task_create', { project: 'one/project', title: 'Задача', status: 'new', slug: 'task', source: { text: 'текст' } }],
    ['note', { kind: 'journal', scope: g, text: 'итог' }],
  ];
  for (const [name, args] of rows) assert.deepEqual(remoteToolCommand(name, args, writer, '/run/u'), toolCommand(name, args), name);
  assert.deepEqual(remoteToolCommand('task_update', { key: 'MP-1', status: 'done', reason: 'ok', progress: 'p' }, projectWriter, undefined), [
    { name: 'task_status', key: 'MP-1', status: 'done', reason: 'ok', envScope: 'MP' },
    { name: 'task_progress', key: 'MP-1', text: 'p', artifacts: [] },
  ]);
  assert.deepEqual(remoteToolCommand('task_update', { key: 'MP-1', parent: null, reason: 'r' }, projectWriter, undefined),
    [{ name: 'task_parent', key: 'MP-1', parent: null, reason: 'r' }]);
  assert.deepEqual(remoteToolCommand('send_message', { key: 'MP', text: 'go' }, writer, '/run/u'),
    [{ name: 'message_send', key: 'MP', body: { text: 'go' }, envScope: 'global', runtime: '/run/u' }]);
  assert.deepEqual(remoteToolCommand('send_message', { key: 'MP', text: 'go' }, writer, undefined),
    [{ name: 'message_send', key: 'MP', body: { text: 'go' }, envScope: 'global' }]);
});

test('remote schemas refuse file inputs, local-only fields and foreign actions', () => {
  const create = { project: 'one/project', title: 'Задача', status: 'new', slug: 'task', source: { text: 'текст' } };
  const refused: [string, unknown][] = [
    ['task_create', { ...create, source: { file: '/etc/passwd' } }],
    ['task_create', { ...create, adoptSource: false }],
    ['task_update', { key: 'MP-1', progress: 'p', artifacts: [] }],
    ['task_update', { key: 'MP-1', reason: 'x' }],
    ['task_update', { key: 'MP-1', touch: true, progress: 'p' }],
    ['note', { kind: 'note', scope: g, title: 't', body: { text: 'b' } }],
    ['note', { kind: 'error', project: 'one/project', text: 't' }],
    ['note', { kind: 'capture', source: { text: 't' } }],
    ['projects', { action: 'add', identity: 'a/b', code: 'AB' }],
    ['projects', { action: 'update', identity: 'a/b', repository: 'local', expectedRepository: null }],
    ['projects', { action: 'resolve', path: '/tmp' }],
    ['projects', { action: 'list', identity: 'a/b' }],
  ];
  const valid: Record<string, unknown> = {
    task_list: {}, task_show: { key: 'MP-1' }, journal: { scope: 'all' }, context_read: { path: 'a.md' },
    projects: { action: 'list' }, task_create: create, task_update: { key: 'MP-1', touch: true },
    note: { kind: 'journal', scope: g, text: 't' }, send_message: { key: 'MP', text: 'go' },
  };
  for (const name of remoteToolNames('write')) {
    assert.doesNotThrow(() => remoteToolCommand(name, valid[name], writer, undefined), name);
    refused.push([name, { ...(valid[name] as object), unexpected: true }]);
  }
  for (const [name, args] of refused) assert.throws(() => remoteToolCommand(name, args, writer, undefined), name + ' ' + JSON.stringify(args));
});

test('task_create tells a remote agent to register tasks only on request, one per independent problem', () => {
  assert.match(remoteTools.task_create.description, /only when the user explicitly asks/);
  assert.match(remoteTools.task_create.description, /one task per independent problem/);
});

function remote(token?: (value: string) => RemoteToken | undefined) {
  const commands: AppCommand[] = [], logged: string[] = [];
  const handler = createRemoteMcp({
    token: token ?? (value => ({ 'r-token': reader, 'w-token': writer } as Record<string, RemoteToken>)[value]),
    execute: async command => { commands.push(command); return { ok: true }; },
    runtime: '/run/u', version: '9.9.9', log: line => { logged.push(line); },
  });
  return { handler, commands, logged };
}
function post(handler: (request: Request) => Promise<{ response: Response; token?: string }>, token: string, body: unknown) {
  return handler(new Request('http://localhost/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + token,
    accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
}
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
const call = (name: string, args: unknown) => ({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } });

test('remote MCP refuses a missing or unknown bearer token with 401 before any MCP work and answers POST only', async () => {
  const { handler, commands } = remote();
  for (const authorization of [undefined, 'Basic x', 'Bearer nope']) {
    const result = await handler(new Request('http://localhost/mcp', { method: 'POST',
      headers: { ...(authorization === undefined ? {} : { authorization }), accept: 'application/json, text/event-stream',
        'content-type': 'application/json' }, body: JSON.stringify(initialize) }));
    assert.equal(result.response.status, 401, String(authorization));
    assert.equal(result.response.headers.get('www-authenticate'), 'Bearer realm="mypi"');
    assert.equal(result.token, undefined);
  }
  for (const method of ['GET', 'DELETE']) {
    const result = await handler(new Request('http://localhost/mcp', { method, headers: { authorization: 'Bearer r-token' } }));
    assert.equal(result.response.status, 405, method);
    assert.equal(result.response.headers.get('allow'), 'POST');
    assert.equal(result.token, 'reader');
  }
  assert.equal(commands.length, 0);
});

test('an unreadable token file answers a fixed JSON-RPC 500 without its path and logs the real error once', async () => {
  const { handler, commands, logged } = remote(() => { throw new Error('EACCES: /secret/dir/api-tokens.json'); });
  const result = await post(handler, 'w-token', initialize);
  assert.equal(result.response.status, 500);
  const body = await result.response.text();
  assert.deepEqual(JSON.parse(body), { jsonrpc: '2.0', error: { code: -32603, message: 'API token file is unreadable' }, id: null });
  assert.equal(result.token, undefined);
  assert.equal(commands.length, 0);
  assert.doesNotMatch(body, /\/secret\/dir/);
  assert.deepEqual(logged, ['EACCES: /secret/dir/api-tokens.json']);
});

test('remote MCP initializes statelessly and lists only the tools of the token\'s permission', async () => {
  const { handler } = remote();
  const init = await post(handler, 'r-token', initialize);
  assert.equal(init.response.status, 200);
  assert.match(init.response.headers.get('content-type') ?? '', /^application\/json/);
  assert.equal(init.response.headers.get('mcp-session-id'), null);
  assert.deepEqual((await init.response.json()).result.serverInfo, { name: 'mypi', version: '9.9.9' });
  const list = async (token: string) => (await (await post(handler, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).response.json())
    .result.tools as { name: string; description: string; inputSchema: unknown }[];
  assert.deepEqual((await list('r-token')).map(t => t.name), remoteToolNames('read'));
  const written = await list('w-token');
  assert.deepEqual(written.map(t => t.name), remoteToolNames('write'));
  for (const name of ['task_create', 'note', 'task_update']) {
    const schema = JSON.stringify(written.find(t => t.name === name)!.inputSchema);
    for (const field of ['"file"', '"adoptSource"', '"artifacts"']) assert(!schema.includes(field), name + ' ' + field);
  }
  assert.equal(written.find(t => t.name === 'task_create')!.description, remoteTools.task_create.description);
});

test('remote tools/call runs commands with the token\'s sender, keeps the status envelope and refuses writes for read tokens', async () => {
  const { handler, commands } = remote();
  const result = async (token: string, name: string, args: unknown) => (await (await post(handler, token, call(name, args))).response.json()).result;
  const sent = await result('w-token', 'send_message', { key: 'MP', text: 'go' });
  assert.deepEqual(sent.structuredContent, { status: 'ok', data: { ok: true } });
  assert.deepEqual(commands, [{ name: 'message_send', key: 'MP', body: { text: 'go' }, envScope: 'global', runtime: '/run/u' }]);
  commands.length = 0;
  const create = { project: 'one/project', title: 'Задача', status: 'new', slug: 'task', source: { text: 'текст' } };
  const refused = await result('r-token', 'task_create', create);
  assert.equal(refused.isError, true);
  assert.deepEqual(refused.structuredContent, { status: 'error', message: 'This token is read-only' });
  const file = await result('w-token', 'task_create', { ...create, source: { file: '/etc/passwd' } });
  assert.equal(file.isError, true);
  assert.equal(file.structuredContent.status, 'error');
  assert.equal(commands.length, 0);
  const unknown = await result('w-token', 'open_session', { keys: ['MP'] });
  assert.equal(unknown.isError, true);
  assert.equal(unknown.structuredContent.message, 'Unknown tool: open_session');
});
