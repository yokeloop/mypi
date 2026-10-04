import test from 'node:test';
import assert from 'node:assert/strict';
import { tools, toolCommand } from '../../src/mcp/tools.js';
import { success, failure } from '../../src/mcp/result.js';
import { PartialError } from '../../src/shared/context.js';
import { serialCalls } from '../../src/mcp/serial.js';
import { appCommand } from '../../src/cli/app-command.js';
import { parseCommand } from '../../src/cli/command.js';

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
  ['context_commit', { paths: ['MEMORY.md'], message: 'reconciled' }],
  ['context_restore', { path: 'MEMORY.md', revision: 'a'.repeat(40) }],
  ['db_init', {}], ['bootstrap', {}], ['backup', { destination: '/tmp/snapshot' }],
  ['restore', { backupDirectory: '/tmp/snapshot' }],
];
test('31 independent tool examples retain every field; strict schemas reject unknown/nested fields and wrong types', () => {
  assert.equal(examples.length, 31);
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
  assert.deepEqual(translate(['journal', 'read', '--all', '--type', 'note', '--limit', '2']),
    { name: 'journal_read', scope: 'all', eventType: 'note', limit: 2 });
  assert.deepEqual(translate(['memory', 'add', 'fact']), { name: 'memory_add', scope: { type: 'global' }, text: 'fact' });
  assert.deepEqual(translate(['request', 'create', 's', '--title', 'T', '--status', 'custom', '--slug', 'task']),
    { name: 'request_create', title: 'T', status: 'custom', slug: 'task', source: { text: 's' }, project: null, adoptSource: false });
  assert.throws(() => translate(['capture', 's', '--file', '/tmp/s']), /not both/);
});
test('partial is never success; structured and text results agree with every recovery field', () => {
  const expected = { status: 'partial', message: 'commit failed', saved: ['database'], missing: ['git'], paths: ['x'], requestId: 17 };
  const result = failure(new PartialError('commit failed', ['database'], ['git'], ['x'], 17));
  assert.equal(result.isError, true); assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), expected);
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
