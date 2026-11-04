import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteTools, remoteToolNames, remoteToolCommand } from '../../src/mcp/remote-tools.js';
import type { RemoteToken } from '../../src/mcp/remote-tools.js';
import { toolCommand } from '../../src/mcp/tools.js';
import { tasks } from '../../src/mcp/tools/tasks.js';
import { knowledge } from '../../src/mcp/tools/knowledge.js';
import { sessionTools } from '../../src/mcp/tools/sessions.js';

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
