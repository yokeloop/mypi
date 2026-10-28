import test from 'node:test';
import assert from 'node:assert/strict';
import { tools, toolCommand, readOnly } from '../../src/mcp/tools.js';
import { success, failure } from '../../src/mcp/result.js';
import { PartialError } from '../../src/shared/context.js';
import { serialCalls } from '../../src/mcp/serial.js';
import { runSequence } from '../../src/mcp/sequence.js';
import { InputError } from '../../src/shared/errors.js';
import type { AppCommand } from '../../src/app/commands.js';
import { appCommand } from '../../src/cli/app-command.js';
import { parseCommand } from '../../src/cli/command.js';

const scope = { type: 'project', key: 'MP' };
const g = { type: 'global' }, rev = 'a'.repeat(64);
const cli = (argv: string[]) => {
  const parsed = parseCommand(argv);
  if (parsed.type === 'help') throw new Error('Unexpected help');
  return appCommand(parsed, {});
};
test('MCP lists exactly twelve agent tools; maintenance and replaced names are unknown tools', () => {
  assert.deepEqual(Object.keys(tools).sort(), ['context_read', 'context_write', 'journal', 'memory', 'note', 'projects',
    'sessions', 'task_create', 'task_list', 'task_show', 'task_update', 'warmup']);
  assert.deepEqual([...readOnly].sort(), ['context_read', 'journal', 'sessions', 'task_list', 'task_show', 'warmup']);
  for (const name of ['project_list', 'project_add', 'project_update', 'project_resolve', 'memory_show', 'memory_add',
    'memory_remove', 'capture', 'note_add', 'error_add', 'journal_read', 'journal_add', 'journal_import', 'task_status',
    'task_title', 'task_progress', 'task_touch', 'status_list', 'status_add', 'status_rename', 'status_terminal',
    'status_remove', 'context_commit', 'context_restore', 'db_init', 'bootstrap', 'backup', 'backup_publish', 'restore',
    'restore_published', 'home_migrate_tasks', 'task_worktree', 'session_register', 'session_unregister', 'session_forget', 'unknown', '__proto__'])
    assert.throws(() => toolCommand(name, {}), /Unknown tool/);
});
test('every MCP call translates to the same AppCommands as its CLI commands', () => {
  const rows: [string, Record<string, unknown>, string[][], Record<string, unknown>?][] = [
    ['warmup', { scope: 'MP' }, [['warmup', '-s', 'MP']]],
    ['projects', { action: 'list', org: 'one' }, [['project', 'list', '--org', 'one']]],
    ['projects', { action: 'add', identity: 'one/project', code: 'MP', checkoutPath: '/tmp' }, [['project', 'add', 'one/project', '--code', 'MP', '--path', '/tmp']]],
    ['projects', { action: 'update', identity: 'one/project', expectedCheckoutPath: null, checkoutPath: '/tmp/new' }, [['project', 'update', 'one/project', '--expected-unset', '--path', '/tmp/new']]],
    ['projects', { action: 'resolve', path: '/tmp' }, [['project', 'resolve', '/tmp']]],
    ['memory', { action: 'show', scope: g }, [['memory', 'show']]],
    ['memory', { action: 'add', scope: g, text: 'fact' }, [['memory', 'add', 'fact']]],
    ['memory', { action: 'remove', scope: g, number: 1, expectedRevision: rev }, [['memory', 'remove', '1', '--expected-revision', rev]]],
    ['memory', { action: 'show', scope: { type: 'project', key: 'MP' } }, [['memory', 'show', '-s', 'one/project']], { scope: { type: 'project', key: 'MP' } }],
    ['note', { kind: 'note', scope: g, title: 'T', body: { text: 'body' } }, [['note', 'T', 'body']]],
    ['note', { kind: 'journal', scope: g, text: 'outcome' }, [['journal', 'add', 'outcome']]],
    ['note', { kind: 'error', project: 'one/project', text: 'dead end' }, [['error', 'one/project', 'dead end']]],
    ['note', { kind: 'capture', source: { text: '\ufeff x\r\n' } }, [['capture', '\ufeff x\r\n']]],
    ['journal', { scope: 'all', eventType: 'note', limit: 2 }, [['journal', 'read', '--all', '--type', 'note', '--limit', '2']]],
    ['task_list', { project: 'one/project', status: 'custom' }, [['task', 'list', '--project', 'one/project', '--status', 'custom']]],
    ['task_show', { key: 'MP-1' }, [['task', 'show', 'MP-1']]],
    ['task_create', { project: 'one/project', title: 'T', status: 'custom', slug: 'task', source: { text: 's' }, adoptSource: false },
      [['task', 'create', 's', '--project', 'one/project', '--title', 'T', '--status', 'custom', '--slug', 'task']]],
    ['task_update', { key: 'MP-1', status: 'done', reason: 'verified' }, [['task', 'status', 'MP-1', 'done', '--reason', 'verified']]],
    ['task_update', { key: 'MP-1', title: 'new', reason: 'clarified' }, [['task', 'title', 'MP-1', 'new', '--reason', 'clarified']]],
    ['task_update', { key: 'MP-1', progress: 'done' }, [['task', 'progress', 'MP-1', 'done']]],
    ['task_update', { key: 'MP-1', touch: true }, [['task', 'touch', 'MP-1']]],
    ['task_update', { key: 'MP-1', status: 'done', title: 'new', reason: 'verified', progress: 'done' },
      [['task', 'status', 'MP-1', 'done', '--reason', 'verified'], ['task', 'title', 'MP-1', 'new', '--reason', 'verified'], ['task', 'progress', 'MP-1', 'done']]],
    ['context_read', { path: 'MEMORY.md' }, [['context', 'read', 'MEMORY.md']]],
    ['context_write', { paths: ['MEMORY.md'], message: 'reconciled' }, [['context', 'commit', 'MEMORY.md', '--message', 'reconciled']]],
    ['sessions', {}, [['sessions']]],
  ];
  for (const [tool, args, argvs, patch] of rows) {
    assert.deepEqual(toolCommand(tool, args), argvs.map(argv => ({ ...cli(argv), ...patch })));
    assert.throws(() => toolCommand(tool, { ...args, unexpected: true }), /Unrecognized/);
  }
  assert.deepEqual(new Set(rows.map(r => r[0])), new Set(Object.keys(tools)));
  assert.deepEqual(toolCommand('task_update', { key: 'MP-1', progress: 'done', artifacts: [{ path: 'a.md', text: 'proof' }, { path: 'b.png' }] }),
    [{ name: 'task_progress', key: 'MP-1', text: 'done', artifacts: [{ path: 'a.md', text: 'proof' }, { path: 'b.png' }] }]);
});
test('action tools and task_update reject missing, foreign and malformed fields', () => {
  for (const [name, args, re] of [
    ['memory', { action: 'add', text: 'no scope' }, /scope is required for action add/],
    ['memory', { action: 'show', scope: g, text: 'x' }, /text is not allowed for action show/],
    ['memory', { action: 'remove', scope: g, number: 1 }, /expectedRevision is required/],
    ['memory', { action: 'remove', scope: g, number: '1', expectedRevision: rev }, /number/],
    ['memory', { action: 'add', scope: { type: 'task', key: 'MP-1' }, text: 'x' }, /Context scope cannot be task/],
    ['memory', { action: 'drop', scope: g }, /action/],
    ['note', { kind: 'capture', source: { text: 'x', file: '/tmp/x' } }, /source/],
    ['note', { kind: 'capture', source: { file: 'relative' } }, /Absolute path/],
    ['note', { kind: 'capture', source: { text: 'x' }, scope: g }, /scope is not allowed for kind capture/],
    ['note', { kind: 'journal', scope: g, text: 'x', title: 'T' }, /title is not allowed for kind journal/],
    ['note', { kind: 'error', text: 'x' }, /project is required for kind error/],
    ['note', { kind: 'note', scope: { type: 'task', key: 'MP-1' }, title: 'T', body: { text: 'b' } }, /Context scope cannot be task/],
    ['projects', { action: 'resolve', path: 'relative' }, /Absolute path/],
    ['projects', { action: 'update', identity: 'one/project', checkoutPath: '/tmp/new' }, /expectedCheckoutPath is required for action update/],
    ['projects', { action: 'update', identity: 'one/project', expectedCheckoutPath: 'relative', checkoutPath: '/tmp/new' }, /Absolute path/],
    ['projects', { action: 'list', path: '/tmp' }, /path is not allowed for action list/],
    ['projects', { action: 'add', identity: 'one/project', code: 'MP', expectedCheckoutPath: null }, /expectedCheckoutPath is not allowed for action add/],
    ['task_update', { key: 'MP-1' }, /needs status, title, progress or touch/],
    ['task_update', { key: 'MP-1', status: 'done' }, /reason is required/],
    ['task_update', { key: 'MP-1', progress: 'x', reason: 'r' }, /reason is allowed only/],
    ['task_update', { key: 'MP-1', touch: true, status: 'done', reason: 'r' }, /touch is allowed only alone/],
    ['task_update', { key: 'MP-1', artifacts: [{ path: 'x' }] }, /artifacts require progress/],
    ['task_update', { key: 'MP-1', touch: false }, /touch/],
    ['task_update', { key: 'MP-1', progress: 'x', artifacts: [{ path: 'x', other: 1 }] }, /Unrecognized/],
    ['warmup', { scope: { type: 'task', key: 'MP-1' } }, /scope/],
    ['warmup', { scope: 7 }, /scope/],
    ['warmup', { maxChars: 9500 }, /Unrecognized/],
    ['journal', { scope: g, limit: 0 }, /limit/],
    ['task_create', { title: 'T', status: 'new', slug: 'task', source: { text: 's' } }, /project/],
  ] as const) assert.throws(() => toolCommand(name, args), re);
});
test('CLI translates to the same subject commands without changing text or default scope', () => {
  const translate = (args: string[], env: Record<string, string> = {}, parentPid?: number) => {
    const parsed = parseCommand(args);
    if (parsed.type === 'help') throw new Error('Unexpected help');
    return appCommand(parsed, env, parentPid);
  };
  assert.deepEqual(translate(['warmup']), { name: 'warmup' });
  assert.deepEqual(translate(['warmup', '-s', 'MP'], { MYPI_SCOPE: 'MP-12' }), { name: 'warmup', scope: 'MP', envScope: 'MP-12' });
  assert.deepEqual(translate(['warmup', '--max-chars', '9500']), { name: 'warmup', maxChars: 9500 });
  assert.deepEqual(toolCommand('warmup', {}, { MYPI_SCOPE: 'MP-12' }), [{ name: 'warmup', envScope: 'MP-12' }]);
  assert.deepEqual(toolCommand('memory', { action: 'show', scope }, { MYPI_SCOPE: 'MP' }), [{ name: 'memory_show', scope }]);
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
  assert.deepEqual(translate(['task', 'create', 's', '--project', 'one/project', '--title', 'T', '--status', 'custom', '--slug', 'task']),
    { name: 'task_create', title: 'T', status: 'custom', slug: 'task', source: { text: 's' }, project: 'one/project', adoptSource: false });
  assert.throws(() => translate(['task', 'create', 's', '--title', 'T', '--status', 'custom', '--slug', 'task']), /--project required/);
  assert.deepEqual(translate(['task', 'worktree', 'MP-1']), { name: 'task_worktree', key: 'MP-1' });
  assert.deepEqual(translate(['backup', '--publish', '--dry-run', '--file', 'a.md', '--file', 'b.md']),
    { name: 'backup_publish', dryRun: true, selectedPaths: ['a.md', 'b.md'] });
  assert.deepEqual(translate(['restore', '--repository', '/tmp/clone', '--commit', 'a'.repeat(40)]),
    { name: 'restore_published', repository: '/tmp/clone', commit: 'a'.repeat(40) });
  assert.deepEqual(translate(['backup', '/tmp/snapshot']), { name: 'backup', destination: '/tmp/snapshot' });
  assert.deepEqual(translate(['restore', '/tmp/snapshot']), { name: 'restore', backupDirectory: '/tmp/snapshot' });
  for (const args of [['backup', '--publish', '/tmp/snapshot'], ['backup', '--dry-run'],
    ['backup', '/tmp/snapshot', '--file', 'x'], ['restore', '--repository', '/tmp/clone'],
    ['restore', '/tmp/snapshot', '--commit', 'a'.repeat(40)]]) assert.throws(() => translate(args));
  assert.throws(() => translate(['capture', 's', '--file', '/tmp/s']), /not both/);
  assert.deepEqual(translate(['session', 'register', '--agent', 'pi', '--pid', '42', '--native-id', 'p1', '--name', 'n', '--fork'],
    { MYPI_SCOPE: 'MP-12', XDG_RUNTIME_DIR: '/run/user/1' }),
  { name: 'session_register', agent: 'pi', pid: 42, nativeId: 'p1', sessionName: 'n', fork: true, envScope: 'MP-12', runtime: '/run/user/1' });
  assert.equal((translate(['session', 'register', '--agent', 'claude', '--pid', '42', '--native-id', 'c1', '--socket', '/s']) as { socket?: string }).socket, '/s');
  assert.equal((translate(['session', 'register', '--agent', 'claude', '--pid', '42', '--native-id', 'c1'],
    { CLAUDE_CODE_MESSAGING_SOCKET: '/m' }) as { socket?: string }).socket, '/m');
  assert.throws(() => translate(['session', 'register', '--agent', 'codex', '--pid', '42', '--native-id', 'c1']), /--agent must be claude or pi/);
  assert.throws(() => translate(['session', 'register', '--agent', 'pi', '--pid', '42', '--hook']), /only for --agent claude/);
  assert.throws(() => translate(['session', 'register', '--agent', 'claude', '--pid', '42', '--hook', '--native-id', 'x']), /not both/);
  assert.deepEqual(translate(['session', 'unregister', '--pid', '7']), { name: 'session_unregister', pid: 7 });
  assert.deepEqual(translate(['session', 'forget', 'MP-12']), { name: 'session_forget', key: 'MP-12' });
  assert.deepEqual(translate(['warmup'], { CLAUDE_CODE_SESSION_ID: 'c1' }, 42), { name: 'warmup', session: { agent: 'claude', nativeId: 'c1', pid: 42 } });
  assert.deepEqual(toolCommand('warmup', {}, { PI_SESSION_ID: 'p1', XDG_RUNTIME_DIR: '/run/user/1' }, 7),
    [{ name: 'warmup', session: { agent: 'pi', nativeId: 'p1', pid: 7, runtime: '/run/user/1' } }]);
  assert.deepEqual(toolCommand('sessions', {}, { XDG_RUNTIME_DIR: '/run/user/1' }), [{ name: 'sessions', runtime: '/run/user/1' }]);
  assert.throws(() => toolCommand('sessions', { key: 'x' }), /Unrecognized/);
});
test('partial is never success; structured and text results agree with every recovery field', () => {
  const expected = { status: 'partial', message: 'commit failed', saved: ['database'], missing: ['git'], paths: ['x'], taskId: 17 };
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
test('task_update parts run in order; a failure after a saved part is partial with saved and missing parts', async () => {
  const commands = [{ name: 'task_status', key: 'MP-1', status: 'done', reason: 'r' },
    { name: 'task_title', key: 'MP-1', title: 'new', reason: 'r' },
    { name: 'task_progress', key: 'MP-1', text: 'done', artifacts: [] }] as AppCommand[];
  const card = { id: 7, contextDir: 'projects/one/project/tasks/MP-1-x' };
  const sequence = (outcomes: Record<string, () => unknown>, parts = commands) => {
    const calls: string[] = [];
    const run = runSequence(parts, async command => { calls.push(command.name); return outcomes[command.name]?.() ?? command.name; });
    return { calls, run };
  };
  const ok = sequence({});
  assert.equal(await ok.run, 'task_progress');
  assert.deepEqual(ok.calls, ['task_status', 'task_title', 'task_progress']);
  const refused = new InputError('Terminal task cannot change status; create a continuation');
  const first = sequence({ task_status: () => { throw refused; } });
  await assert.rejects(first.run, error => error === refused);
  assert.deepEqual(first.calls, ['task_status']);
  const later = sequence({ task_status: () => card, task_title: () => { throw new Error('busy'); } });
  await assert.rejects(later.run, (error: unknown) => {
    assert(error instanceof PartialError);
    assert.match(error.message, /task_update stopped at title after saving status: busy/);
    assert.deepEqual([error.saved, error.missing, error.paths, error.taskId],
      [['status'], ['title', 'progress'], ['projects/one/project/tasks/MP-1-x'], 7]);
    return true;
  });
  assert.deepEqual(later.calls, ['task_status', 'task_title']);
  const nested = sequence({ task_status: () => card, task_progress: () => {
    throw new PartialError('commit failed', ['artifacts'], ['inspect artifacts', 'journal', 'activity timestamp'],
      ['projects/one/project/tasks/MP-1-x/a.md'], 7);
  } }, [commands[0]!, commands[2]!]);
  await assert.rejects(nested.run, (error: unknown) => {
    assert(error instanceof PartialError);
    assert.deepEqual([error.saved, error.missing, error.paths, error.taskId],
      [['status', 'artifacts'], ['inspect artifacts', 'journal', 'activity timestamp'], ['projects/one/project/tasks/MP-1-x/a.md'], 7]);
    return true;
  });
});
