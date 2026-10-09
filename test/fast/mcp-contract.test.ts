import test from 'node:test';
import assert from 'node:assert/strict';
import { tools, toolCommand } from '../../src/mcp/tools.js';
import { success, failure } from '../../src/mcp/result.js';
import { PartialError } from '../../src/shared/context.js';
import type { HomeRecovery } from '../../src/shared/home-writer.js';
import { output } from '../../src/mcp/schemas.js';
import { serialCalls } from '../../src/mcp/serial.js';
import { appCommand } from '../../src/cli/app-command.js';
import { parseCommand } from '../../src/cli/command.js';
import { executePolicyCommand } from '../../src/app/policy-commands.js';
import { hasMembershipGuard } from '../../src/app/command-membership.js';
import { validateWorkspaceOperation } from '../../src/app/workspace-commands.js';

const scope = { type: 'project', key: 'MP' };
const examples: [string, Record<string, unknown>][] = [
  ['project_list', { org: 'one' }], ['project_add', { identity: 'one/project', code: 'MP', checkoutPath: '/tmp' }],
  ['project_resolve', { path: '/tmp' }], ['warmup', { scope }], ['memory_show', { scope }],
  ['memory_add', { scope, text: 'fact' }], ['memory_remove', { scope, number: 1 }],
  ['capture', { source: { text: '\ufeff x\r\n' } }], ['note_add', { scope, title: 'T', body: { file: '/tmp/input' } }],
  ['error_add', { project: 'one/project', text: 'error' }], ['journal_add', { scope, text: 'outcome' }],
  ['journal_read', { scope: 'all', from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z', eventType: 'note', limit: 10 }],
  ['request_list', { project: 'one/project', status: 'custom' }], ['request_show', { key: 'MP-1' }],
  ['request_create', { project: null, title: 'T', status: 'custom', slug: 'task', source: { text: 'source' }, adoptSource: true }],
  ['request_status', { key: 'MP-1', status: 'done', reason: 'verified' }],
  ['request_title', { key: 'MP-1', title: 'new', reason: 'clarified' }],
  ['request_progress', { key: 'MP-1', text: 'done', artifacts: [{ path: 'a.md', text: 'proof' }, { path: 'b.png' }] }],
  ['request_touch', { key: 'MP-1' }], ['status_list', {}], ['status_add', { code: 'custom', terminal: false }],
  ['status_rename', { code: 'custom', newCode: 'renamed' }], ['status_terminal', { code: 'custom', terminal: true }],
  ['status_remove', { code: 'custom' }], ['context_read', { path: 'MEMORY.md' }],
  ['home_document_patch', { path: 'docs/notes/literal[1].md', expected: 'a'.repeat(64), text: '\ufeffexact\r\n' }],
  ['home_status', {}], ['home_reconcile', {}],
  ['context_commit', { paths: ['MEMORY.md'], message: 'reconciled' }],
  ['context_restore', { path: 'MEMORY.md', revision: 'a'.repeat(40) }],
  ['db_init', {}], ['bootstrap', {}], ['backup', { destination: '/tmp/snapshot' }],
  ['restore', { backupDirectory: '/tmp/snapshot' }],
  ['workspace_prepare', { project: 'one/project', baseRoot: '/base', worktreeRoot: '/task', branch: 'task/one', startPoint: 'refs/heads/main' }],
  ['workspace_inspect', { project: 'one/project' }],
  ['workspace_commit', { project: 'one/project', worktreeRoot: '/task', branch: 'task/one', paths: ['literal[1].txt'], message: 'exact' }],
  ['workspace_publish', { project: 'one/project', worktreeRoot: '/task', branch: 'task/one', remote: 'origin' }],
  ['message_send', { instanceKey: '11111111-1111-4111-8111-111111111111', messageId: 'one', text: 'exact\r\ntext', ttlMs: 1000 }],
  ['message_list', { receiverNativeSessionId: 'pi-owned-id' }],
  ['message_show', { receiverNativeSessionId: 'pi-owned-id', messageId: 'one' }],
  ['message_cleanup', { receiverNativeSessionId: 'pi-owned-id', messageId: 'one' }],
  ['session_list', { project: 'one/project', includeArchived: true }],
  ['session_show', { instanceKey: '11111111-1111-4111-8111-111111111111', all: true }],
  ['session_archive', { instanceKey: '11111111-1111-4111-8111-111111111111', project: 'one/project' }],
  ['policy_validate', { text: 'version: 2' }],
  ['policy_explain', { guard: 'outsideWorktreeWrite', text: 'version: 2' }],
];
test('47 independent tool examples retain every field; strict schemas reject unknown/nested fields and wrong types', () => {
  assert.equal(examples.length, 47);
  assert.deepEqual(Object.keys(tools).sort(), examples.map(([name]) => name).sort());
  for (const [name, args] of examples) {
    assert.deepEqual(toolCommand(name, args), { name, ...args });
    assert.throws(() => toolCommand(name, { ...args, unexpected: true }), /Unrecognized/);
  }
  for (const [name, args] of [
    ['memory_add', { text: 'no default scope' }], ['warmup', { scope: { type: 'request', key: 'MP-1' } }],
    ['warmup', { scope: { type: 'global', key: 'MP' } }], ['memory_remove', { scope, number: '1' }],
    ['capture', { source: { text: 'x', file: '/tmp/x' } }], ['capture', { source: { file: 'relative' } }],
    ['request_create', { title: 'T', status: 'new', slug: 'task', source: { text: 's' } }],
    ['request_progress', { key: 'MP-1', text: 'x', artifacts: [{ path: 'x', other: 1 }] }],
    ['project_resolve', { path: 'relative' }], ['backup', { destination: 'relative' }],
    ['status_add', { code: 'x', terminal: 'false' }], ['journal_read', { scope, limit: 0 }],
    ['workspace_prepare', { project: 'one/project', worktreeRoot: '/task', branch: 'task/one' }],
    ['workspace_commit', { project: 'one/project', worktreeRoot: '/task', branch: 'task/one', paths: [], message: 'x' }],
    ['workspace_publish', { project: 'one/project', worktreeRoot: '/task', branch: 'task/one', remote: 'origin', force: true }],
    ['home_document_patch', { path: 'doc.md', text: 'missing preimage' }],
    ['home_document_patch', { path: 'doc.md', expected: 'a'.repeat(64) }],
    ['home_document_patch', { path: 'doc.md', expected: null, text: 'not creation' }],
    ['home_document_patch', { path: 'doc.md', expected: 'A'.repeat(64), text: '' }],
    ['home_document_patch', { path: 'doc.md', expected: 'abc', text: '' }],
    ['message_send', { instanceKey: '11111111-1111-4111-8111-111111111111', messageId: 'one', text: 'x', sender: 'invented' }],
    ['message_send', { instanceKey: '11111111-1111-4111-8111-111111111111', messageId: 'one', text: 'я'.repeat(8193) }],
    ['message_show', { receiverNativeSessionId: 'pi-owned-id', messageId: '../bad' }],
    ['message_list', { receiverNativeSessionId: '' }],
    ['session_list', { project: 'one/project', all: true }], ['session_list', { project: 'MP' }],
    ['session_show', { instanceKey: '../escape', all: true }],
    ['session_archive', { instanceKey: '11111111-1111-4111-8111-111111111111', includeArchived: true }],
    ['home_status', { path: 'doc.md' }], ['home_reconcile', { replay: true }],
    ['policy_validate', { file: '/tmp/policy.yaml' }],
    ['policy_explain', { guard: 'unknown' }],
    ['policy_explain', { guard: 'baseCheckoutWrite', file: '/tmp/policy.yaml' }],
    ['policy_explain', { guard: 'baseCheckoutWrite', text: null }],
    ['policy_preview', { text: 'version: 2' }],
    ['unknown', {}], ['__proto__', {}],
  ] as const) assert.throws(() => toolCommand(name, args));
});
test('CLI preserves text and omissions while explicit MCP scope/project remain required', () => {
  const translate = (args: string[]) => {
    const parsed = parseCommand(args);
    if (parsed.type === 'help' || parsed.type === 'pi' || parsed.type === 'session-control') throw new Error('Expected data command');
    return appCommand(parsed);
  };
  for (const [argv, name] of [
    [['message', 'send', '11111111-1111-4111-8111-111111111111', 'one', 'exact\r\ntext', '--ttl-ms', '1000'], 'message_send'],
    [['message', 'list', 'pi-owned-id'], 'message_list'],
    [['message', 'show', 'pi-owned-id', 'one'], 'message_show'],
    [['message', 'cleanup', 'pi-owned-id', 'one'], 'message_cleanup'],
    [['session', 'list', '--project', 'one/project', '--archived'], 'session_list'],
    [['session', 'show', '11111111-1111-4111-8111-111111111111', '--all'], 'session_show'],
    [['session', 'archive', '11111111-1111-4111-8111-111111111111', '--project', 'one/project'], 'session_archive'],
    [['workspace', 'prepare', '/task', '--project', 'one/project', '--base', '/base', '--branch', 'task/one', '--start', 'refs/heads/main'], 'workspace_prepare'],
    [['workspace', 'inspect', '--project', 'one/project'], 'workspace_inspect'],
    [['workspace', 'commit', 'literal[1].txt', '--project', 'one/project', '--worktree', '/task', '--branch', 'task/one', '--message', 'exact'], 'workspace_commit'],
    [['workspace', 'publish', '--project', 'one/project', '--worktree', '/task', '--branch', 'task/one', '--remote', 'origin'], 'workspace_publish'],
  ] as const) {
    const expected = examples.find(([key]) => key === name)!;
    assert.deepEqual(translate([...argv]), { name, ...expected[1] });
  }
  for (const [argv, expected] of [
    [['home', 'document-patch', 'docs/notes/literal[1].md', '\ufeffexact\r\n', '--expected', 'a'.repeat(64)],
      { name: 'home_document_patch', path: 'docs/notes/literal[1].md', expected: 'a'.repeat(64), text: '\ufeffexact\r\n' }],
    [['home', 'document-patch', 'empty.md', '', '--expected', 'b'.repeat(64)],
      { name: 'home_document_patch', path: 'empty.md', expected: 'b'.repeat(64), text: '' }],
    [['home', 'status'], { name: 'home_status' }], [['home', 'reconcile'], { name: 'home_reconcile' }],
  ] as const) {
    assert.deepEqual(translate([...argv]), expected);
    const { name, ...args } = expected;
    const command = toolCommand(name, args);
    assert.deepEqual(command, expected);
    assert.equal(hasMembershipGuard(command), false, 'explicit home-wide operator route, no project default');
  }
  assert.deepEqual(translate(['session', 'list']), { name: 'session_list' });
  assert.deepEqual(toolCommand('session_list', {}), { name: 'session_list' });
  assert.throws(() => translate(['session', 'list', '--project', 'one/project', '--all']), /mutually exclusive/);
  assert.throws(() => translate(['session', 'show', '11111111-1111-4111-8111-111111111111', '--archived']));
  for (const [name, args] of examples.filter(([name]) => name.startsWith('session_'))) {
    assert.equal(hasMembershipGuard(toolCommand(name, args)), false, 'cache filters require no registry/ACL');
  }
  assert.throws(() => translate(['home', 'document-patch', 'doc.md', 'text']), /--expected required/);
  assert.throws(() => translate(['home', 'document-patch', 'doc.md', '--expected', 'a'.repeat(64)]), /argument count/);
  assert.throws(() => translate(['home', 'status', '--scope', 'one/project']));
  assert.throws(() => translate(['home', 'reconcile', 'replay']));
  assert.throws(() => translate(['workspace', 'publish', '--project', 'one/project', '--worktree', '/task', '--branch', 'task/one']), /--remote required/);
  assert.deepEqual(translate(['capture', '\ufeff x\r\n']), { name: 'capture', source: { text: '\ufeff x\r\n' } });
  assert.deepEqual(translate(['journal', 'read', '--all', '--type', 'note', '--limit', '2']),
    { name: 'journal_read', scope: 'all', eventType: 'note', limit: 2 });
  assert.deepEqual(translate(['memory', 'add', 'fact']), { name: 'memory_add', text: 'fact' });
  assert.deepEqual(translate(['journal', 'add', 'fact']), { name: 'journal_add', text: 'fact' });
  assert.deepEqual(translate(['journal', 'add', 'fact', '--scope', '']),
    { name: 'journal_add', text: 'fact', scope: { type: 'global' } });
  assert.deepEqual(translate(['journal', 'read', '--scope', 'global']),
    { name: 'journal_read', scope: { reference: 'global' } });
  assert.deepEqual(translate(['request', 'create', 's', '--title', 'T', '--status', 'custom', '--slug', 'task']),
    { name: 'request_create', title: 'T', status: 'custom', slug: 'task', source: { text: 's' }, adoptSource: false });
  assert.throws(() => translate(['capture', 's', '--file', '/tmp/s']), /not both/);
  for (const [name, args] of examples.filter(([name]) => name.startsWith('policy_'))) {
    const argv = name === 'policy_validate' ? ['policy', 'validate', String(args['text'])]
      : ['policy', 'explain', String(args['guard']), String(args['text'])];
    assert.deepEqual(translate(argv), toolCommand(name, args));
  }
  assert.deepEqual(translate(['policy', 'explain', 'baseCheckoutWrite']),
    toolCommand('policy_explain', { guard: 'baseCheckoutWrite' }));
  for (const action of ['validate', 'explain']) {
    const args = action === 'validate' ? [] : ['baseCheckoutWrite'];
    assert.throws(() => translate(['policy', action, ...args, 'version: 2', '--file', '/tmp/p']), /not both/);
    assert.throws(() => translate(['policy', action, ...args, 'version: 2', '--file', '']), /not both/);
    assert.throws(() => translate(['policy', action, ...args, '--file', '']), /--file required/);
  }
  assert.throws(() => translate(['policy', 'validate']), /Text or --file required/);
  assert.throws(() => translate(['policy', 'explain', 'unknown']), /Unknown policy guard/);
  assert.throws(() => translate(['policy', 'explain', 'baseCheckoutWrite', '--target', '{}']));
  assert.throws(() => translate(['policy', 'preview']), /Unknown command/);
});
test('workspace arguments preserve literal names and reject implicit revisions or unsafe file selections', () => {
  const command = { name: 'workspace_commit' as const, project: 'one/project', worktreeRoot: '/task', branch: 'task/one', paths: ['literal[1].txt'], message: 'exact' };
  validateWorkspaceOperation(command);
  for (const paths of [[], ['a', 'a'], ['/absolute'], ['../escape'], ['dir/../file'], ['.git/config'], ['dir//file'], ['a\0b']]) {
    assert.throws(() => validateWorkspaceOperation({ ...command, paths }));
  }
  for (const startPoint of ['main', 'HEAD~1', '--all', 'refs/remotes/origin/main']) {
    assert.throws(() => validateWorkspaceOperation({ name: 'workspace_prepare', project: command.project,
      worktreeRoot: '/task', branch: command.branch, startPoint }));
  }
  for (const startPoint of ['refs/heads/main', 'refs/tags/v1', 'a'.repeat(40)]) {
    validateWorkspaceOperation({ name: 'workspace_prepare', project: command.project, worktreeRoot: '/task', branch: command.branch, startPoint });
  }
});
test('policy diagnostics default only absent text and never reinterpret incompatible or invalid input', () => {
  assert.deepEqual(executePolicyCommand({ name: 'policy_explain', guard: 'baseCheckoutWrite' }), {
    guard: 'baseCheckoutWrite', behavior: 'block',
    message: 'Configured to block when writing to the base checkout.', diagnostic: 'cooperative',
  });
  assert.deepEqual(executePolicyCommand({ name: 'policy_explain', guard: 'baseCheckoutWrite',
    text: 'version: 2\nguards: {baseCheckoutWrite: warn}' }), {
    guard: 'baseCheckoutWrite', behavior: 'warn',
    message: 'Configured to warn when writing to the base checkout.', diagnostic: 'cooperative',
  });
  for (const [text, message] of [
    ['', /expected mapping/], ['version: 1', /version 1 is incompatible/],
    ['version: 9', /version: expected 2/], ['version: 2\nunknown: true', /unknown field/],
  ] as const) {
    assert.throws(() => executePolicyCommand({ name: 'policy_validate', text }), message);
    assert.throws(() => executePolicyCommand({ name: 'policy_explain', guard: 'baseCheckoutWrite', text }), message);
  }
});
test('partial is never success; structured and text results agree with every recovery field', () => {
  const expected = { status: 'partial', message: 'commit failed', saved: ['database'], missing: ['git'], paths: ['x'], requestId: 17 };
  const result = failure(new PartialError('commit failed', ['database'], ['git'], ['x'], 17));
  assert.equal(result.isError, true); assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), expected);
  assert.deepEqual(output.parse(expected), expected);
  const home: HomeRecovery = { needsAttention: true, head: 'b'.repeat(40), remoteHead: null, remoteOutcome: 'unknown',
    pending: { id: 'a2fb6a17-f4b7-4b39-837d-bc994cecc974', operation: 'request_create', paths: ['x'],
      beforeHead: 'a'.repeat(40), phase: 'publishing', commit: 'b'.repeat(40), destinationId: 'c'.repeat(64) } };
  const coordinated = failure(new PartialError('commit failed', ['database'], ['git'], ['x'], 17, home));
  assert.deepEqual(coordinated.structuredContent, { ...expected, home });
  assert.deepEqual(JSON.parse((coordinated.content[0] as { text: string }).text), { ...expected, home });
  assert.deepEqual(output.parse(coordinated.structuredContent), { ...expected, home });
  assert.throws(() => output.parse({ ...expected, home: { ...home, unexpected: true } }), /Unrecognized/);
  assert.throws(() => output.parse({ ...expected, home: { ...home, pending: { ...home.pending, unexpected: true } } }), /Unrecognized/);
  assert.throws(() => output.parse({ ...expected, home: { ...home, needsAttention: false } }));
  assert.deepEqual(failure(new Error('bad')).structuredContent, { status: 'error', message: 'bad' });
  assert.deepEqual(success({ path: 'x' }).structuredContent, { status: 'ok', data: { path: 'x' } });
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
