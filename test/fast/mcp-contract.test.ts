import test from 'node:test';
import assert from 'node:assert/strict';
import { tools, toolCommand, readOnly } from '../../src/mcp/tools.js';
import { success, failure } from '../../src/mcp/result.js';
import { PartialError } from '../../src/shared/context.js';
import { serialCalls } from '../../src/mcp/serial.js';
import { appCommand } from '../../src/cli/app-command.js';
import { parseCommand } from '../../src/cli/command.js';

const scope = { type: 'project', key: 'MP' };
const preview = { action: 'open', binding: { projectId: 1, requestId: 2, sourceClone: '/tmp/clone',
  worktree: '/tmp/task', gitCommonDir: '/tmp/clone/.git', branch: 'task/example',
  installation: '/tmp/engine', statePath: '/tmp/state' },
  model: { provider: 'provider', model: 'model/id', source: 'invocation' } };
const examples: [string, Record<string, unknown>][] = [
  ['project_list', { org: 'one' }], ['project_add', { identity: 'one/project', code: 'MP', checkoutPath: '/tmp' }],
  ['project_update', { identity: 'one/project', expectedCheckoutPath: null, checkoutPath: '/tmp/new' }],
  ['project_resolve', { path: '/tmp' }], ['warmup', { scope }], ['memory_show', { scope }],
  ['memory_add', { scope, text: 'fact' }], ['memory_remove', { scope, number: 1, expectedRevision: 'a'.repeat(64) }],
  ['capture', { source: { text: '\ufeff x\r\n' } }], ['note_add', { scope, title: 'T', body: { file: '/tmp/input' } }],
  ['error_add', { project: 'one/project', text: 'error' }], ['journal_add', { scope, text: 'outcome' }], ['journal_import', {}],
  ['journal_read', { scope: 'all', from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z', eventType: 'note', limit: 10 }],
  ['request_list', { project: 'one/project', status: 'custom' }], ['request_show', { key: 'MP-1' }],
  ['request_create', { project: null, title: 'T', status: 'custom', slug: 'task', source: { text: 'source' }, adoptSource: true }],
  ['request_status', { key: 'MP-1', status: 'done', reason: 'verified' }],
  ['request_title', { key: 'MP-1', title: 'new', reason: 'clarified' }],
  ['request_progress', { key: 'MP-1', text: 'done', artifacts: [{ path: 'a.md', text: 'proof' }, { path: 'b.png' }] }],
  ['request_touch', { key: 'MP-1' }], ['status_list', {}], ['status_add', { code: 'custom', terminal: false }],
  ['status_rename', { code: 'custom', newCode: 'renamed' }], ['status_terminal', { code: 'custom', terminal: true }],
  ['status_remove', { code: 'custom' }], ['context_read', { path: 'MEMORY.md' }],
  ['context_commit', { paths: ['MEMORY.md'], message: 'reconciled' }],
  ['context_restore', { path: 'MEMORY.md', revision: 'a'.repeat(40) }],
  ['db_init', {}], ['bootstrap', {}], ['backup', { destination: '/tmp/snapshot' }],
  ['restore', { backupDirectory: '/tmp/snapshot' }],
  ['backup_publish', { dryRun: true, selectedPaths: ['chosen.md'] }],
  ['restore_published', { repository: '/tmp/clone', commit: 'a'.repeat(40) }],
  ['work_chat_open_request', { identity: 'one/project', requestId: 2, chatId: 'chat-id',
    association: { sourceClone: '/tmp/clone', worktree: '/tmp/task' }, nameLabel: 'Chat', model: { provider: 'provider', model: 'model/id' }, focus: false }],
  ['work_chat_open', { identity: 'one/project', requestId: 2, sourceClone: '/tmp/clone', worktree: '/tmp/task', model: { provider: 'provider', model: 'model/id' } }],
  ['work_chat_resume', { id: 'chat-id', model: { provider: 'provider', model: 'model/id' } }],
  ['work_chat_new_empty', { id: 'chat-id' }], ['work_chat_execute', { preview, focus: false }],
  ['work_chat_list', {}], ['work_chat_show', { id: 'chat-id' }],
];
test('42 independent tool examples retain every field; strict schemas reject unknown/nested fields and wrong types', () => {
  assert.equal(examples.length, 42);
  assert.deepEqual(Object.keys(tools).sort(), examples.map(([name]) => name).sort());
  for (const [name, args] of examples) {
    assert.deepEqual(toolCommand(name, args), { name, ...args });
    assert.throws(() => toolCommand(name, { ...args, unexpected: true }), /Unrecognized/);
  }
  for (const [name, args] of [
    ['memory_add', { text: 'no default scope' }], ['warmup', { scope: { type: 'request', key: 'MP-1' } }],
    ['warmup', { scope: { type: 'global', key: 'MP' } }], ['memory_remove', { scope, number: '1', expectedRevision: 'a'.repeat(64) }], ['memory_remove', { scope, number: 1 }],
    ['capture', { source: { text: 'x', file: '/tmp/x' } }], ['capture', { source: { file: 'relative' } }],
    ['request_create', { title: 'T', status: 'new', slug: 'task', source: { text: 's' } }],
    ['request_progress', { key: 'MP-1', text: 'x', artifacts: [{ path: 'x', other: 1 }] }],
    ['project_resolve', { path: 'relative' }],
    ['project_update', { identity: 'one/project', checkoutPath: '/tmp/new' }],
    ['project_update', { identity: 'one/project', expectedCheckoutPath: 'relative', checkoutPath: '/tmp/new' }],
    ['project_update', { identity: 'one/project', expectedCheckoutPath: null, checkoutPath: 'relative' }],
    ['backup', { destination: 'relative' }],
    ['backup_publish', { selectedPaths: 'not an array' }], ['restore_published', { repository: 'relative', commit: 'a'.repeat(40) }],
    ['status_add', { code: 'x', terminal: 'false' }], ['journal_read', { scope, limit: 0 }],
    ['work_chat_open_request', { identity: 'one/project', requestId: 2, model: { provider: 'fixture', model: 'exact', source: 'invocation' } }],
    ['work_chat_open_request', { identity: 'one/project', requestId: 2, model: { model: 'exact' } }],
    ['work_chat_open_request', { identity: 'one/project', requestId: 2, chatId: '' }],
    ['unknown', {}], ['__proto__', {}],
  ] as const) assert.throws(() => toolCommand(name, args));
});
test('CLI translates to the same subject commands without changing text or default scope', () => {
  const translate = (args: string[]) => {
    const parsed = parseCommand(args);
    if (parsed.type === 'help') throw new Error('Unexpected help');
    return appCommand(parsed);
  };
  assert.deepEqual(translate(['capture', '\ufeff x\r\n']), { name: 'capture', source: { text: '\ufeff x\r\n' } });
  assert.deepEqual(translate(['journal', 'import']), { name: 'journal_import' });
  assert.deepEqual(translate(['journal', 'read', '--all', '--type', 'note', '--limit', '2']),
    { name: 'journal_read', scope: 'all', eventType: 'note', limit: 2 });
  assert.deepEqual(translate(['project', 'resolve', '/tmp']), { name: 'project_resolve', path: '/tmp' });
  assert.deepEqual(translate(['project', 'update', 'one/project', '--expected-unset', '--path', '/tmp/new']),
    { name: 'project_update', identity: 'one/project', expectedCheckoutPath: null, checkoutPath: '/tmp/new' });
  assert.deepEqual(translate(['project', 'update', 'one/project', '--expected-path', '/tmp/old', '--path', '/tmp/new']),
    { name: 'project_update', identity: 'one/project', expectedCheckoutPath: '/tmp/old', checkoutPath: '/tmp/new' });
  for (const args of [['project', 'update', 'one/project', '--path', '/tmp/new'],
    ['project', 'update', 'one/project', '--expected-path', '/tmp/old', '--expected-unset', '--path', '/tmp/new']])
    assert.throws(() => translate(args), /exactly one/);
  assert.deepEqual(translate(['memory', 'remove', '1', '--expected-revision', 'a'.repeat(64)]),
    { name: 'memory_remove', scope: { type: 'global' }, number: 1, expectedRevision: 'a'.repeat(64) });
  assert.throws(() => translate(['memory', 'remove', '1']), /expected-revision/);
  assert.deepEqual(translate(['memory', 'add', 'fact']), { name: 'memory_add', scope: { type: 'global' }, text: 'fact' });
  assert.deepEqual(translate(['request', 'create', 's', '--title', 'T', '--status', 'custom', '--slug', 'task']),
    { name: 'request_create', title: 'T', status: 'custom', slug: 'task', source: { text: 's' }, project: null, adoptSource: false });
  assert.deepEqual(translate(['backup', '--publish', '--dry-run', '--file', 'a.md', '--file', 'b.md']),
    { name: 'backup_publish', dryRun: true, selectedPaths: ['a.md', 'b.md'] });
  assert.deepEqual(translate(['restore', '--repository', '/tmp/clone', '--commit', 'a'.repeat(40)]),
    { name: 'restore_published', repository: '/tmp/clone', commit: 'a'.repeat(40) });
  assert.deepEqual(translate(['work-chat', 'resume', 'chat-id', '--provider', 'provider', '--model', 'model/with/slashes']),
    { name: 'work_chat_resume', id: 'chat-id', model: { provider: 'provider', model: 'model/with/slashes' } });
  assert.deepEqual(translate(['work-chat', 'resume', 'chat-id', '--model', 'provider/model/with/slashes']),
    { name: 'work_chat_resume', id: 'chat-id', model: { provider: 'provider', model: 'model/with/slashes' } });
  assert.throws(() => translate(['work-chat', 'resume', 'chat-id', '--provider', 'provider']), /requires --model/);
  assert.deepEqual(translate(['backup', '/tmp/snapshot']), { name: 'backup', destination: '/tmp/snapshot' });
  assert.deepEqual(translate(['restore', '/tmp/snapshot']), { name: 'restore', backupDirectory: '/tmp/snapshot' });
  for (const args of [['backup', '--publish', '/tmp/snapshot'], ['backup', '--dry-run'],
    ['backup', '/tmp/snapshot', '--file', 'x'], ['restore', '--repository', '/tmp/clone'],
    ['restore', '/tmp/snapshot', '--commit', 'a'.repeat(40)]]) assert.throws(() => translate(args));
  assert.throws(() => translate(['capture', 's', '--file', '/tmp/s']), /not both/);
});
test('partial is never success; structured and text results agree with every recovery field', () => {
  const expected = { status: 'partial', message: 'commit failed', saved: ['database'], missing: ['git'], paths: ['x'], requestId: 17 };
  const result = failure(new PartialError('commit failed', ['database'], ['git'], ['x'], 17));
  assert.equal(result.isError, true); assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), expected);
  assert.deepEqual(failure(new Error('bad')).structuredContent, { status: 'error', message: 'bad' });
  assert.deepEqual(success({ path: 'x' }).structuredContent, { status: 'ok', data: { path: 'x' } });
  const publishPartial = success({ status: 'partial', snapshotSaved: true, commit: 'a'.repeat(40), publicationConfirmed: false });
  assert.equal(publishPartial.isError, true);
  assert.deepEqual(publishPartial.structuredContent, JSON.parse((publishPartial.content[0] as { text: string }).text));
});
test('calls serialize async work; cancelled pending calls and calls after stop have no effects', async () => {
  const queue = serialCalls(), events: string[] = [], controller = new AbortController();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const first = queue.run(new AbortController().signal, async () => { events.push('start'); await held; events.push('end'); });
  const cancelled = queue.run(controller.signal, async () => { events.push('forbidden'); });
  const rejection = assert.rejects(cancelled, /cancelled/);
  const last = queue.run(new AbortController().signal, async () => { events.push('last'); });
  await Promise.resolve(); assert.deepEqual(events, ['start']);
  controller.abort(); release(); await Promise.all([first, rejection, last]);
  assert.deepEqual(events, ['start', 'end', 'last']);
  const closing = serialCalls();
  let finish!: () => void;
  const active = closing.run(new AbortController().signal, async () => {
    await new Promise<void>(resolve => { finish = resolve; }); events.push('drained');
  });
  await Promise.resolve();
  const pending = closing.run(new AbortController().signal, async () => { events.push('forbidden'); });
  const pendingRejection = assert.rejects(pending, /cancelled/);
  const stopped = closing.stop();
  finish(); await Promise.all([active, stopped, pendingRejection]);
  assert.equal(events.at(-1), 'drained');
  await queue.stop();
  await assert.rejects(queue.run(new AbortController().signal, async () => { events.push('forbidden'); }), /cancelled/);
});

test('work-chat opening is an explicit mutation with CLI/MCP selection and setup parity; previews stay read-only', () => {
  const translate = (args: string[]) => {
    const parsed = parseCommand(['work-chat', ...args]);
    assert.notEqual(parsed.type, 'help');
    return appCommand(parsed as Exclude<typeof parsed, { type: 'help' }>);
  };
  const base = { identity: 'one/project', requestId: 2 };
  assert.deepEqual(translate(['open-request', '--project', 'one/project', '--request-id', '2']),
    toolCommand('work_chat_open_request', base));
  assert.deepEqual(translate(['open-request', '--project', 'one/project', '--request-id', '2', '--chat-id', 'chosen',
    '--source-clone', '/tmp/clone', '--worktree', '/tmp/task', '--name', 'Chat', '--model', 'provider/model/id', '--no-focus']),
    toolCommand('work_chat_open_request', { ...base, chatId: 'chosen', association: { sourceClone: '/tmp/clone', worktree: '/tmp/task' },
      nameLabel: 'Chat', model: { provider: 'provider', model: 'model/id' }, focus: false }));
  for (const args of [['--source-clone', '/tmp/clone'], ['--worktree', '/tmp/task'], ['--request-id', '0']]) {
    assert.throws(() => translate(['open-request', '--project', 'one/project', '--request-id', '2', ...args]));
  }
  assert.throws(() => toolCommand('work_chat_open_request', { ...base, association: { sourceClone: '/tmp/clone' } }));
  assert.throws(() => translate(['adopt-model']), /removed.*native \/model.*same Pi session/);
  assert.throws(() => translate(['sync-attempt', '--receipt', '{}']), /Unknown command/);
  assert.throws(() => toolCommand('work_chat_sync_attempt', {}), /Unknown tool/);
  for (const name of ['work_chat_open', 'work_chat_resume', 'work_chat_new_empty', 'work_chat_list', 'work_chat_show'] as const)
    assert.equal(readOnly.has(name), true, name);
  assert.equal(readOnly.has('work_chat_open_request'), false);
  assert.equal(readOnly.has('work_chat_execute'), false);
  const choice = { status: 'error', outcome: 'choice-needed', chats: [{ id: 'a' }, { id: 'b' }], reason: 'Select a chat' };
  const result = success(choice);
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, { status: 'error', data: choice });
});

test('CLI and MCP preview inputs require current revision and preserve optional origin without readiness', () => {
  const current = { ...preview, action: 'resume', chatId: 'chat', priorAttempt: 'attempt', priorRevision: 'a'.repeat(64),
    live: { pane: 'w1:p1', processId: 123, processStart: 'tick', processBootId: 'boot', herdrEndpoint: '/tmp/herdr.sock' }, persisted: false };
  const parse = (value: unknown) => {
    const command = parseCommand(['work-chat', 'execute', '--preview', JSON.stringify(value)]);
    if (command.type === 'help') throw new Error('Unexpected help');
    return appCommand(command);
  };
  for (const value of [current, { ...current, action: 'new-empty' }, { ...current, live: undefined }]) {
    const jsonValue = JSON.parse(JSON.stringify(value));
    assert.deepEqual(parse(jsonValue), toolCommand('work_chat_execute', { preview: jsonValue, focus: false }));
  }
  for (const value of [{ ...current, priorRevision: undefined }, { ...current, priorAttempt: undefined },
    { ...current, readiness: 'ready' }, { ...current, live: { ...current.live, herdrEndpoint: 'https://foreign' } },
    { ...current, live: { ...current.live, herdrEndpoint: '/tmp/herdr.sock?secret' } },
    { ...current, live: { ...current.live, processBootId: '' } }, { ...current, live: { ...current.live, herdrEndpoint: '/tmp/a/../b' } }]) {
    const jsonValue = JSON.parse(JSON.stringify(value));
    assert.throws(() => parse(jsonValue));
    assert.throws(() => toolCommand('work_chat_execute', { preview: jsonValue }));
  }
});
