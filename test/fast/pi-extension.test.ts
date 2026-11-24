import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { TestContext } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEMODE_GUIDELINE, install, isEscape } from '../../.pi/extensions/mypi-lib/install.js';
import type { RunCli } from '../../.pi/extensions/mypi-lib/install.js';
import { cellWidth, wrapQuestion } from '../../.pi/extensions/mypi-lib/ask.js';
import { runtimeDir } from '../../.pi/extensions/mypi-lib/runtime-dir.js';
import { frame, parentFrame, startFrame } from '../../src/modules/events/public.js';
import { pointerLine } from '../../src/shared/switch-pointer.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const description = 'Local mypi tools for projects, tasks, history and knowledge. No automatic initialization or writes.';
const cli = join(root, 'dist/src/cli/main.js');
const reg = (id: string, ...extra: string[]) => ['node', [cli, 'session', 'register', '--agent', 'pi', '--pid', String(process.pid), '--native-id', id, ...extra], { cwd: root, timeout: 5000 }];
const serve = async () => ({ close: async () => {} });
const warm = (key: string) => ['node', [cli, 'warmup', '-s', key], { cwd: root, timeout: 5000 }];

function stub() {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<unknown> | unknown>();
  const servers: { name: string; config: any }[] = [], removed: string[] = [], calls: unknown[][] = [], sent: unknown[][] = [];
  const notes: [string, string][] = [];
  const statuses: [string, string | undefined][] = [];
  const inputs: ((data: string) => { consume?: boolean; data?: string } | undefined)[] = [];
  const terminal = { unsubscribed: 0 };
  const commands = new Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void>; getArgumentCompletions?: (prefix: string) => Promise<unknown> }>();
  const tools = new Map<string, any>();
  const registration = () => ({ code: 0, killed: false, stdout: JSON.stringify({ key: state.key, registered: true }) + '\n', stderr: '' });
  const state = { id: 's1', key: 'global', idle: true, name: undefined as string | undefined, file: undefined as string | undefined, header: null as { parentSession?: string } | null, leaf: null as string | null,
    result: (_command: string, args: string[]): unknown => args[1] === 'session' ? registration() : { code: 0, killed: false, stdout: '', stderr: '' } };
  const api = {
    on(name: string, handler: (event: any, ctx: any) => Promise<unknown> | unknown) { handlers.set(name, handler); },
    registerMcpServer(name: string, config: unknown) { servers.push({ name, config }); },
    unregisterMcpServer(name: string) { removed.push(name); },
    registerCommand(name: string, command: { description: string; handler: (args: string, ctx: any) => Promise<void>; getArgumentCompletions?: (prefix: string) => Promise<unknown> }) { commands.set(name, command); },
    async exec(command: string, args: string[], options: unknown) { calls.push([command, args, options]); return state.result(command, args); },
    sendUserMessage(content: string, options?: unknown) { sent.push([content, options]); },
    registerTool(tool: any) { tools.set(tool.name, tool); },
  };
  const ctx = { hasUI: true, ui: { notify(message: string, level: string) { notes.push([message, level]); },
    setStatus(key: string, text: string | undefined) { statuses.push([key, text]); },
    onTerminalInput(handler: (data: string) => { consume?: boolean; data?: string } | undefined) {
      inputs.push(handler);
      return () => { terminal.unsubscribed++; };
    } },
    isIdle: () => state.idle,
    sessionManager: { getSessionId: () => state.id, getSessionName: () => state.name, getSessionFile: () => state.file, getHeader: () => state.header, getLeafId: () => state.leaf } };
  const start = async (reason: string) => { await handlers.get('session_start')?.({ reason }, ctx); };
  const stop = async (reason: string) => { await handlers.get('session_shutdown')?.({ reason }, ctx); };
  const turn = async () => {
    const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
    await handlers.get('before_agent_start')?.(event, ctx);
    return event.systemPromptOptions.sections;
  };
  const options = async (toolGuidelines?: Record<string, string[]>) => {
    const event = { systemPromptOptions: { sections: {} as Record<string, string>, ...(toolGuidelines ? { toolGuidelines } : {}) } };
    await handlers.get('before_agent_start')?.(event, ctx);
    return event.systemPromptOptions as { sections: Record<string, string>; toolGuidelines?: Record<string, string[]> };
  };
  return { api: api as never, handlers, commands, tools, ctx, servers, removed, calls, sent, notes, statuses, inputs, terminal, state, start, stop, turn,
    options, registration };
}

test('pi extension registers mypi MCP with the session id and loads warmup into every turn', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  assert.equal(pi.servers.length, 0);
  assert.deepEqual(pi.calls, []);
  assert.deepEqual([...pi.handlers.keys()].sort(), ['agent_before_settle', 'agent_end', 'agent_settled', 'agent_start', 'before_agent_start', 'input', 'session_shutdown', 'session_start', 'ui_prompt_start']);
  assert.deepEqual([...pi.commands.keys()], ['open', 'inbox', 'flow', 'epic']);
  assert.deepEqual([...pi.tools.keys()], ['mypi_ask']);
  assert.deepEqual(await pi.turn(), {});
  pi.state.result = (_command, args) => args[1] === 'session' ? pi.registration() : { code: 0, killed: false, stdout: '# mypi warmup: global\n', stderr: '' };
  await pi.start('startup');
  assert.deepEqual(pi.servers, [{ name: 'mypi', config: { command: 'node', args: [join(root, 'dist/src/mcp/main.js')], cwd: root,
    env: { PI_SESSION_ID: 's1' }, description, exposure: 'codemode', toolExposure: { projects: 'direct', warmup: 'direct', archive_search: 'direct' } } }]);
  assert.deepEqual(pi.calls, [reg('s1'), warm('global')]);
  const options = await pi.options();
  assert.deepEqual(options.toolGuidelines, { codemode: [CODEMODE_GUIDELINE] });
  assert.equal(options.sections.mypi_context, '# mypi warmup: global\n');
  assert.equal((await pi.turn()).mypi_context, '# mypi warmup: global\n');
  assert.equal((await pi.turn()).mypi_context, '# mypi warmup: global\n');
  assert.equal(pi.calls.length, 2);
  await pi.start('reload');
  assert.equal(pi.servers.length, 1);
  assert.deepEqual(pi.removed, []);
  assert.equal(pi.calls.length, 3);
  assert.deepEqual(pi.calls[2], reg('s1'));
  pi.state.id = 's2';
  pi.state.key = 'MP-12';
  pi.state.result = (_command, args) => args[1] === 'session' ? pi.registration() : { code: 0, killed: false, stdout: '# mypi warmup: MP-1 (one/project)\n', stderr: '' };
  await pi.start('new');
  assert.deepEqual(pi.removed, ['mypi']);
  assert.deepEqual(pi.servers.map(server => server.config.env), [{ PI_SESSION_ID: 's1' }, { PI_SESSION_ID: 's2' }]);
  assert.deepEqual(pi.calls.slice(3), [reg('s2'), warm('MP-12')]);
  assert.equal((await pi.turn()).mypi_context, '# mypi warmup: MP-1 (one/project)\n');
});

test('pi extension adds the codemode await guideline to every turn', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  const fresh = await pi.options();
  assert.deepEqual(fresh.toolGuidelines, { codemode: [CODEMODE_GUIDELINE] });
  assert.deepEqual(fresh.sections, {});
  assert.deepEqual((await pi.options({ codemode: ['pi rule'], read: ['r'] })).toolGuidelines, { codemode: ['pi rule', CODEMODE_GUIDELINE], read: ['r'] });
  assert.deepEqual((await pi.options({ read: ['r'] })).toolGuidelines, { read: ['r'], codemode: [CODEMODE_GUIDELINE] });
  const shared = { codemode: ['pi rule'] };
  await pi.options(shared);
  await pi.options(shared);
  assert.deepEqual(shared.codemode, ['pi rule', CODEMODE_GUIDELINE]);
  assert.ok(CODEMODE_GUIDELINE.includes('await searchTools('));
  assert.ok(CODEMODE_GUIDELINE.includes('describeTool()'));
  assert.ok(CODEMODE_GUIDELINE.includes('describeNamespace()'));
});

test('pi extension reports a failed warmup in the section and keeps MCP', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  pi.state.result = (_command, args) => args[1] === 'session' ? pi.registration()
    : { code: 1, killed: false, stdout: '', stderr: '{"status":"error","message":"Unknown project: XX"}\n' };
  await pi.start('startup');
  assert.deepEqual(pi.calls, [reg('s1'), warm('global')]);
  const failure = 'mypi warmup failed: {"status":"error","message":"Unknown project: XX"}. No mypi context was loaded; call the mypi warmup tool to read it.';
  assert.equal(pi.servers.length, 1);
  assert.deepEqual(pi.servers[0]!.config.env, { PI_SESSION_ID: 's1' });
  assert.equal((await pi.turn()).mypi_context, failure);
  assert.deepEqual(pi.notes, [[failure, 'warning']]);
  pi.state.id = 's2';
  pi.state.result = () => { throw new Error('spawn node ENOENT'); };
  await pi.start('new');
  assert.match((await pi.turn()).mypi_context!, /^mypi warmup failed: spawn node ENOENT\./);
});

test('pi extension registers a hand fork with --fork and the session name, and unregisters only on quit', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  pi.state.header = { parentSession: '/p.jsonl' };
  pi.state.name = 'mp-12';
  await pi.start('startup');
  assert.deepEqual(pi.calls[0], reg('s1', '--name', 'mp-12', '--fork'));
  pi.state.id = 's2';
  await pi.start('fork');
  assert.deepEqual(pi.calls[2], reg('s2', '--name', 'mp-12'));
  const before = pi.calls.length;
  await pi.stop('new');
  await pi.stop('reload');
  assert.equal(pi.calls.length, before);
  await pi.stop('quit');
  assert.deepEqual(pi.calls.at(-1), ['node', [cli, 'session', 'unregister', '--pid', String(process.pid)], { cwd: root, timeout: 5000 }]);
  pi.state.result = () => { throw new Error('spawn node ENOENT'); };
  await pi.stop('quit');
});

test('pi extension warns on a failed registration and still loads warmup without a key', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  const message = '{"status":"error","message":"XDG_RUNTIME_DIR must be an absolute path; the live session registry is kept there"}';
  pi.state.result = (_command, args) => args[1] === 'session' ? { code: 1, killed: false, stdout: '', stderr: message + '\n' }
    : { code: 0, killed: false, stdout: '# mypi warmup: global\n', stderr: '' };
  await pi.start('startup');
  assert.deepEqual(pi.notes[0], ['mypi session registration failed: ' + message + '. This session is not in the mypi registry.', 'warning']);
  assert.deepEqual(pi.calls[1], ['node', [cli, 'warmup'], { cwd: root, timeout: 5000 }]);
  assert.equal((await pi.turn()).mypi_context, '# mypi warmup: global\n');
});

test('pi extension emits the last reply and a waiting event only in a turn a parent message started', async t => {
  const pi = stub();
  const { run, batches, serve } = sockets(t);
  install(pi.api, root, serve, run);
  pi.state.key = 'MP-12';
  await pi.start('startup');
  const emitTo = (to: string, ...args: string[]) => ['node', [cli, 'event', 'emit', '--from', 'MP-12', '--to', to, ...args], { cwd: root, timeout: 5000 }];
  const emit = (...args: string[]) => emitTo('MP', ...args);
  const end = (...messages: { role: string; content?: unknown }[]) => pi.handlers.get('agent_end')!({ messages }, pi.ctx);
  const settle = () => pi.handlers.get('agent_settled')!(undefined, pi.ctx);
  const prompt = (event: { kind: string; title?: string }) => pi.handlers.get('ui_prompt_start')!(event, pi.ctx);
  let id = 0;
  const batch = async (text: string) => {
    void batches[0]!([{ id: ++id, text }]);
    await settled();
    await pi.handlers.get('agent_start')!(undefined, pi.ctx);
    await settled();
  };
  const parent = () => batch(parentFrame('MP', 'MP-12', 'go'));
  const before = pi.calls.length;
  end({ role: 'assistant', content: [{ type: 'text', text: 'human turn' }] });
  await prompt({ kind: 'confirm', title: 'Allow?' });
  await settle();
  await batch(frame({ id: 9, fromKey: 'MP-7', toKey: 'MP-12', kind: 'turn_end', message: 'x', createdAt: '2026-10-28T14:02:00.000Z', deliveredAt: null }, '14:02'));
  end({ role: 'assistant', content: [{ type: 'text', text: 'report turn' }] });
  await prompt({ kind: 'confirm', title: 'Allow?' });
  await settle();
  await batch(startFrame('MP-12', 'state'));
  end({ role: 'assistant', content: [{ type: 'text', text: 'start turn' }] });
  await prompt({ kind: 'confirm', title: 'Allow?' });
  await settle();
  assert.deepEqual(pi.calls.slice(before), []);
  await parent();
  end({ role: 'user', content: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'first' }, { type: 'toolCall', name: 'x' }, { type: 'text', text: 'part' }] }, { role: 'toolResult' });
  await settle();
  assert.deepEqual(pi.calls.slice(before), [emit('--message=first\npart')]);
  end({ role: 'assistant', content: [{ type: 'text', text: 'next' }] });
  await settle();
  await prompt({ kind: 'confirm', title: 'Allow?' });
  assert.equal(pi.calls.length, before + 1);
  await parent();
  end({ role: 'assistant', content: [{ type: 'text', text: 'one' }] });
  end({ role: 'assistant', content: [{ type: 'text', text: 'two' }] }, { role: 'user', content: 'later' });
  end({ role: 'user', content: [{ type: 'text', text: 'no reply' }] });
  await settle();
  assert.deepEqual(pi.calls.at(-1), emit('--message=two'));
  await parent();
  await settle();
  assert.deepEqual(pi.calls.at(-1), emit('--message='));
  await parent();
  end({ role: 'assistant', content: [{ type: 'text', text: 'a'.repeat(31999) + '\u{1F600}' + 'b'.repeat(10) }] });
  await settle();
  assert.deepEqual(pi.calls.at(-1), emit('--message=' + 'a'.repeat(31999)));
  await parent();
  end({ role: 'assistant', content: [{ type: 'text', text: 'c'.repeat(40000) }] });
  await settle();
  assert.deepEqual(pi.calls.at(-1), emit('--message=' + 'c'.repeat(32000)));
  await parent();
  end({ role: 'assistant', content: [{ type: 'text', text: '- Done\n- --help' }] });
  await settle();
  assert.deepEqual(pi.calls.at(-1), emit('--message=- Done\n- --help'));
  await parent();
  await prompt({ kind: 'confirm', title: '-1 file?' });
  assert.deepEqual(pi.calls.at(-1), emit('--waiting', '--message=-1 file?'));
  await prompt({ kind: 'confirm', title: 'Allow rm?' });
  assert.deepEqual(pi.calls.at(-1), emit('--waiting', '--message=Allow rm?'));
  await prompt({ kind: 'input' });
  assert.deepEqual(pi.calls.at(-1), emit('--waiting'));
  await parent();
  end({ role: 'assistant', content: [{ type: 'text', text: 'slow' }] });
  const result = pi.state.result;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  pi.state.result = (command, args) => held.then(() => result(command, args));
  const pending = settle();
  await settled();
  assert.deepEqual(pi.calls.at(-1), emit('--message=slow'));
  await parent();
  end({ role: 'assistant', content: [{ type: 'text', text: 'during' }] });
  release();
  await pending;
  pi.state.result = result;
  await settle();
  assert.deepEqual(pi.calls.at(-1), emit('--message=during'));
  pi.state.result = () => { throw new Error('spawn node ENOENT'); };
  await settle();
  await parent();
  await prompt({ kind: 'confirm' });
  await settle();
  pi.state.result = result;
  await batch(parentFrame('one', 'MP-12', 'go'));
  await prompt({ kind: 'input' });
  assert.deepEqual(pi.calls.at(-1), emitTo('one', '--waiting'));
  end({ role: 'assistant', content: [{ type: 'text', text: 'org' }] });
  await settle();
  assert.deepEqual(pi.calls.at(-1), emitTo('one', '--message=org'));
  await batch(parentFrame('MP', 'MP-12', 'a') + '\n' + parentFrame('one', 'MP-12', 'b'));
  await settle();
  assert.deepEqual(pi.calls.at(-1), emitTo('one', '--message='));
  await parent();
  await settle();
  assert.deepEqual(pi.calls.at(-1), emitTo('MP', '--message='));
});

test('pi extension continues the turn once with the save check and reports the final reply to the parent', async t => {
  const pi = stub();
  const { run, batches, serve: listen } = sockets(t);
  install(pi.api, root, listen, run);
  pi.state.key = 'MP-12';
  const file = pi.state.file = '/s/2026-11-07T10-00-00-000Z_s1.jsonl';
  pi.state.leaf = 'e1';
  await pi.start('startup');
  const check = (...since: string[]) => ['node', [cli, 'turn', 'check', '--agent', 'pi', '--file', file, '--key', 'MP-12', ...since], { cwd: root, timeout: 5000 }];
  const emit = (...args: string[]) => ['node', [cli, 'event', 'emit', '--from', 'MP-12', '--to', 'MP', ...args], { cwd: root, timeout: 5000 }];
  const capture = (file: string) => ['node', [cli, 'archive', 'capture', '--agent', 'pi', '--file', file], { cwd: root, timeout: 5000 }];
  const end = (text: string) => pi.handlers.get('agent_end')!({ messages: [{ role: 'assistant', content: [{ type: 'text', text }] }] }, pi.ctx);
  const settle = () => pi.handlers.get('agent_settled')!(undefined, pi.ctx);
  const before = (entries: unknown[] = [{ type: 'custom', id: 'x' }]) => pi.handlers.get('agent_before_settle')!({ entries }, pi.ctx);
  let id = 0;
  const parent = async () => {
    void batches[0]!([{ id: ++id, text: parentFrame('MP', 'MP-12', 'go') }]);
    await settled();
    await pi.handlers.get('agent_start')!(undefined, pi.ctx);
    await settled();
  };
  const found = () => ({ code: 0, killed: false, stdout: '{"reason":"save it"}\n', stderr: '' });
  let answer: () => unknown = found;
  const result = pi.state.result;
  pi.state.result = (command, args) => args[1] === 'turn' ? answer() : result(command, args);
  const turns = () => pi.calls.filter(call => (call[1] as string[])[1] === 'turn');
  const continued = { entries: [{ type: 'custom', id: 'x' }, { type: 'custom_message', customType: 'mypi-save-check', content: 'save it', display: true }], continue: true };
  assert.deepEqual(await before(), continued);
  assert.deepEqual(pi.calls.at(-1), check('--since', 'e1'));
  const count = pi.calls.length;
  assert.equal(await before(), undefined);
  assert.equal(pi.calls.length, count);
  pi.state.leaf = 'e7';
  await settle();
  assert.deepEqual(await before(), continued);
  assert.deepEqual(turns().at(-1), check('--since', 'e7'));
  for (const failure of [() => ({ code: 1, killed: false, stdout: '', stderr: 'failed\n' }), () => ({ code: 0, killed: true, stdout: '', stderr: '' }),
    () => ({ code: 0, killed: false, stdout: 'not json', stderr: '' }), () => ({ code: 0, killed: false, stdout: '{}\n', stderr: '' }),
    () => { throw new Error('spawn node ENOENT'); }]) {
    await settle();
    answer = failure;
    const checks = turns().length;
    assert.equal(await before(), undefined);
    assert.equal(turns().length, checks + 1);
  }
  answer = found;
  await settle();
  pi.state.file = undefined;
  const checks = turns().length;
  assert.equal(await before(), undefined);
  assert.equal(turns().length, checks);
  pi.state.file = file;
  pi.state.leaf = 'e9';
  await settle();
  await parent();
  const from = pi.calls.length;
  end('draft');
  assert.deepEqual(await before(), continued);
  end('final');
  assert.equal(await before(), undefined);
  await settle();
  assert.deepEqual(pi.calls.slice(from), [check('--since', 'e9'), emit('--message=final'), capture(file)]);

  const keyless = stub();
  install(keyless.api, root, serve, undefined);
  keyless.state.result = (_command, args) => args[1] === 'session' ? { code: 1, killed: false, stdout: '', stderr: 'failed\n' }
    : args[1] === 'turn' ? found() : { code: 0, killed: false, stdout: '# mypi warmup: global\n', stderr: '' };
  keyless.state.file = file;
  await keyless.start('startup');
  assert.equal(await keyless.handlers.get('agent_before_settle')!({ entries: [] }, keyless.ctx), undefined);
  assert(keyless.calls.every(call => (call[1] as string[])[1] !== 'turn'));

  const fresh = stub();
  install(fresh.api, root, serve, undefined);
  fresh.state.key = 'MP-12';
  fresh.state.file = file;
  const plain = fresh.state.result;
  fresh.state.result = (command, args) => args[1] === 'turn' ? found() : plain(command, args);
  await fresh.start('startup');
  assert.deepEqual(await fresh.handlers.get('agent_before_settle')!({ entries: [] }, fresh.ctx),
    { entries: [{ type: 'custom_message', customType: 'mypi-save-check', content: 'save it', display: true }], continue: true });
  assert.deepEqual(fresh.calls.at(-1), check());
});

test('pi extension emits no events without a registered key', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  pi.state.result = (_command, args) => args[1] === 'session' ? { code: 1, killed: false, stdout: '', stderr: 'failed\n' }
    : { code: 0, killed: false, stdout: '# mypi warmup: global\n', stderr: '' };
  await pi.start('startup');
  pi.handlers.get('agent_end')!({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }] }, pi.ctx);
  await pi.handlers.get('agent_settled')!(undefined, pi.ctx);
  await pi.handlers.get('ui_prompt_start')!({ kind: 'confirm', title: 'Allow?' }, pi.ctx);
  assert(pi.calls.every(call => (call[1] as string[])[1] !== 'event'));
});

test('pi extension captures the session file into the archive after every settled turn and runs nothing without one', async t => {
  const capture = (file: string) => ['node', [cli, 'archive', 'capture', '--agent', 'pi', '--file', file], { cwd: root, timeout: 5000 }];
  const pi = stub();
  const settle = () => pi.handlers.get('agent_settled')!(undefined, pi.ctx);
  install(pi.api, root, serve, undefined);
  pi.state.key = 'MP-12';
  await pi.start('startup');
  const before = pi.calls.length;
  await settle();
  pi.state.file = '';
  await settle();
  assert.deepEqual(pi.calls.slice(before), []);
  const file = pi.state.file = '/s/2026-11-07T10-00-00-000Z_s1.jsonl';
  await settle();
  assert.deepEqual(pi.calls.slice(before), [capture(file)]);
  await settle();
  assert.deepEqual(pi.calls.slice(before), [capture(file), capture(file)]);
  pi.state.result = () => { throw new Error('spawn node ENOENT'); };
  await settle();
  assert.deepEqual(pi.calls.at(-1), capture(file));

  const parent = stub();
  const { run, batches, serve: listen } = sockets(t);
  install(parent.api, root, listen, run);
  parent.state.key = 'MP-12';
  parent.state.file = file;
  await parent.start('startup');
  void batches[0]!([{ id: 1, text: parentFrame('MP', 'MP-12', 'go') }]);
  await settled();
  await parent.handlers.get('agent_start')!(undefined, parent.ctx);
  await settled();
  parent.handlers.get('agent_end')!({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }] }, parent.ctx);
  await parent.handlers.get('agent_settled')!(undefined, parent.ctx);
  assert.deepEqual(parent.calls.slice(-2), [['node', [cli, 'event', 'emit', '--from', 'MP-12', '--to', 'MP', '--message=done'], { cwd: root, timeout: 5000 }], capture(file)]);

  const keyless = stub();
  install(keyless.api, root, serve, undefined);
  keyless.state.result = (_command, args) => args[1] === 'session' ? { code: 1, killed: false, stdout: '', stderr: 'failed\n' }
    : { code: 0, killed: false, stdout: '# mypi warmup: global\n', stderr: '' };
  keyless.state.file = file;
  await keyless.start('startup');
  await keyless.handlers.get('agent_settled')!(undefined, keyless.ctx);
  assert.deepEqual(keyless.calls.at(-1), capture(file));
  assert(keyless.calls.every(call => (call[1] as string[])[1] !== 'event'));
});

test('pi extension /open runs mypi open and notifies its result', async () => {
  const pi = stub();
  const runs: unknown[][] = [];
  const stdout = '{"opened":[{"key":"MP-12","agent":"pi","action":"started"}]}';
  let result = { code: 0 as number | null, signal: null, stdout: stdout + '\n', stderr: '' };
  const fake: RunCli = async (args, options) => { runs.push([args, options.cwd]); return result; };
  install(pi.api, root, serve, undefined, process.pid, fake);
  await pi.commands.get('open')!.handler('MP-12  --agent pi', pi.ctx);
  assert.deepEqual(runs.at(-1), [[cli, 'open', 'MP-12', '--agent', 'pi'], root]);
  await pi.commands.get('open')!.handler('MP-12 --session c1 --new', pi.ctx);
  assert.deepEqual(runs.at(-1), [[cli, 'open', 'MP-12', '--session', 'c1', '--new'], root]);
  assert.deepEqual(pi.notes.at(-1), ['mypi open: ' + stdout, 'info']);
  await pi.commands.get('open')!.handler('MP-12 --agent pi --message сделай два  шага ', pi.ctx);
  assert.deepEqual(runs.at(-1), [[cli, 'open', 'MP-12', '--agent', 'pi', '--message', 'сделай два  шага'], root]);
  const error = '{"status":"error","message":"Herdr is not available"}';
  result = { code: 1, signal: null, stdout: '', stderr: error };
  await pi.commands.get('open')!.handler('MP', pi.ctx);
  assert.deepEqual(pi.notes.at(-1), ['mypi open failed: ' + error, 'warning']);
  assert(pi.calls.every(call => !(call[1] as string[]).includes('open')));
});

test('pi extension /open shows clone progress in the status and Esc cancels it', async () => {
  const pi = stub();
  const line = 'mypi: cloning file:///r into /p/fx/big: Receiving objects: 45% (45/100), 12.30 MiB | 1.00 MiB/s';
  const error = '{"status":"error","message":"open cancelled while cloning file:///r into /p/fx/big; nothing was registered"}';
  const fake: RunCli = async (_args, { signal, onLine }) => {
    onLine('mypi: cloning file:///r into /p/fx/big');
    onLine(line);
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return { code: 143, signal: null, stdout: '', stderr: line + '\n' + error + '\n' };
  };
  install(pi.api, root, serve, undefined, process.pid, fake);
  const running = pi.commands.get('open')!.handler('FB --agent pi', pi.ctx);
  await settled();
  assert.deepEqual(pi.statuses, [['mypi-open', 'mypi open FB: running — Esc cancels'], ['mypi-open', 'mypi open FB: cloning — Esc cancels'],
    ['mypi-open', 'mypi open FB: Receiving objects: 45% (45/100), 12.30 MiB | 1.00 MiB/s — Esc cancels']]);
  assert.equal(pi.inputs[0]!('a'), undefined);
  assert.deepEqual(pi.inputs[0]!('\x1b'), { consume: true });
  await running;
  assert.deepEqual(pi.statuses.at(-1), ['mypi-open', undefined]);
  assert.equal(pi.terminal.unsubscribed, 1);
  assert.deepEqual(pi.notes.at(-1), ['mypi open cancelled: ' + error, 'warning']);
  const quick: RunCli = async () => ({ code: 0, signal: null, stdout: '{}', stderr: '' });
  const other = stub();
  install(other.api, root, serve, undefined, process.pid, quick);
  await other.commands.get('open')!.handler('--agent pi FB', other.ctx);
  await other.commands.get('open')!.handler('--agent pi', other.ctx);
  assert.deepEqual(other.statuses.filter(([, text]) => text !== undefined).map(([, text]) => text),
    ['mypi open FB: running — Esc cancels', 'mypi open: running — Esc cancels']);
  for (const data of ['\x1b', '\x1b[27u', '\x1b[27;1u', '\x1b[27;1:1u', '\x1b[27;1;27~']) assert.equal(isEscape(data), true, JSON.stringify(data));
  for (const data of ['\x1b[27;1:3u', '\x1b[A', 'q']) assert.equal(isEscape(data), false, JSON.stringify(data));
});

test('pi extension /inbox runs the inbox skill', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  await pi.commands.get('inbox')!.handler('MP', pi.ctx);
  await pi.commands.get('inbox')!.handler('', pi.ctx);
  assert.deepEqual(pi.sent, [['/skill:inbox MP', { expandPromptTemplates: true }], ['/skill:inbox', { expandPromptTemplates: true }]]);
  assert.deepEqual(pi.calls, []);
});

test('pi extension /flow runs the flow skill', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  await pi.commands.get('flow')!.handler('fx FX-1', pi.ctx);
  await pi.commands.get('flow')!.handler('', pi.ctx);
  assert.deepEqual(pi.sent, [['/skill:flow fx FX-1', { expandPromptTemplates: true }], ['/skill:flow', { expandPromptTemplates: true }]]);
  assert.deepEqual(pi.calls, []);
  assert.equal(pi.commands.get('flow')!.getArgumentCompletions, undefined);
});

test('pi extension /epic runs the epic skill', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  await pi.commands.get('epic')!.handler('FX-1', pi.ctx);
  await pi.commands.get('epic')!.handler('', pi.ctx);
  assert.deepEqual(pi.sent, [['/skill:epic FX-1', { expandPromptTemplates: true }], ['/skill:epic', { expandPromptTemplates: true }]]);
  assert.deepEqual(pi.calls, []);
  assert.equal(pi.commands.get('epic')!.getArgumentCompletions, undefined);
});

test('pi extension mypi_ask asks one question with the recommendation first and the engineer\'s own word last', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  const tool = pi.tools.get('mypi_ask');
  assert.equal(tool.label, 'mypi ask');
  assert.equal(tool.executionMode, 'sequential');
  assert.equal('exposure' in tool, false);
  assert.equal(tool.parameters.properties.options.minItems, 2);
  assert.equal(tool.parameters.properties.options.maxItems, 4);
  assert.deepEqual(tool.parameters.required, ['question', 'options']);
  const ask = async (answers: (string | undefined)[], hasUI = true) => {
    const selects: unknown[][] = [], inputs: unknown[][] = [];
    const signal = new AbortController().signal;
    const ctx = { hasUI, ui: {
      async select(...args: unknown[]) { selects.push(args); return answers.shift(); },
      async input(...args: unknown[]) { inputs.push(args); return answers.shift(); },
    } };
    const result = await tool.execute('call-1', { question: 'Q?', options: ['A', 'B'] }, signal, undefined, ctx);
    return { result, selects, inputs, signal };
  };
  const recommended = await ask(['A (рекомендую)']);
  assert.deepEqual(recommended.result.details, { answer: 'A', custom: false });
  assert.equal(recommended.result.content[0].text, JSON.stringify({ answer: 'A', custom: false }));
  assert.equal(recommended.result.isError, undefined);
  assert.deepEqual(recommended.selects, [['Q?', ['A (рекомендую)', 'B', 'Своё слово'], { signal: recommended.signal }]]);
  assert.deepEqual(recommended.inputs, []);
  assert.deepEqual((await ask(['B'])).result.details, { answer: 'B', custom: false });
  const own = await ask(['Своё слово', ' текст ']);
  assert.deepEqual(own.result.details, { answer: 'текст', custom: true });
  assert.deepEqual(own.inputs, [['Своё слово:', undefined, { signal: own.signal }]]);
  const escape = await ask([undefined]);
  assert.deepEqual(escape.result.details, { answer: null, cancelled: true });
  assert.equal(escape.result.content[0].text, JSON.stringify({ answer: null, cancelled: true }));
  assert.equal(escape.result.isError, undefined);
  assert.deepEqual(escape.inputs, []);
  assert.deepEqual((await ask(['Своё слово', undefined])).result.details, { answer: null, cancelled: true });
  assert.deepEqual((await ask(['Своё слово', '  '])).result.details, { answer: null, cancelled: true });
  const headless = await ask(['A (рекомендую)'], false);
  assert.equal(headless.result.isError, true);
  assert.deepEqual(headless.result.details, { answer: null, error: 'no-ui' });
  assert.deepEqual(headless.selects, []);
});

test('pi extension mypi_ask in the TUI draws its own screen: paragraphs, options and hint always visible, scrolling question', async () => {
  const wrapped = wrapQuestion('Первый абзац.\n\nВторой абзац длиннее ширины экрана\n' + 'x'.repeat(25) + '\n\tтаб\x1b[31m красный\n  отступ', 10);
  assert.deepEqual(wrapped, ['Первый', 'абзац.', '', 'Второй', 'абзац', 'длиннее', 'ширины', 'экрана', 'xxxxxxxxxx', 'xxxxxxxxxx', 'xxxxx', '  таб', 'красный', '  отступ']);
  assert.deepEqual(wrapQuestion('漢字漢字漢字 ab', 4), ['漢字', '漢字', '漢字', 'ab']);
  for (const line of [...wrapped, ...wrapQuestion('漢字漢字漢字 ab', 4)]) assert.ok(cellWidth(line) <= 10);
  assert.deepEqual(wrapQuestion('abc', 0), ['a', 'b', 'c']);
  const pi = stub();
  install(pi.api, root, serve, undefined);
  const tool = pi.tools.get('mypi_ask');
  const open = (question: string, rows = 20, columns = 40, mode = 'tui', answers: (string | undefined)[] = []) => {
    const inputs: unknown[][] = [], selects: unknown[][] = [];
    const seen: { opts?: unknown; renders: number; customs: number; component?: any } = { renders: 0, customs: 0 };
    const controller = new AbortController();
    const ctx = { hasUI: true, mode, ui: {
      custom(factory: any, opts: unknown) {
        seen.customs++;
        seen.opts = opts;
        const tui = { terminal: { rows, columns }, requestRender() { seen.renders++; } };
        return new Promise(resolve => { seen.component = factory(tui, { fg: (_color: string, text: string) => text, bold: (text: string) => text }, { matches: (data: string, id: string) => data === id }, resolve); });
      },
      async input(...args: unknown[]) { inputs.push(args); return answers.shift(); },
      async select(...args: unknown[]) { if (mode === 'tui') throw new Error('select in the TUI'); selects.push(args); return answers.shift(); },
    } };
    const result = tool.execute('call-1', { question, options: ['A', 'B'] }, controller.signal, undefined, ctx);
    const keys = (...ids: string[]) => { for (const id of ids) seen.component.handleInput(id); };
    return { result, inputs, selects, seen, controller, keys, render: () => seen.component.render(columns) as string[] };
  };
  const tail = ['› A (рекомендую)', '  B', '  Своё слово', '↑↓ выбор · ←→ текст · Enter · Esc'];
  const within = (lines: string[], rows: number) => {
    assert.ok(lines.length <= rows);
    for (const line of lines) assert.ok(cellWidth(line) <= 40, line);
    assert.deepEqual(lines.slice(-4), tail);
  };
  const short = open('Факт один.\n\nФакт два.');
  assert.deepEqual(short.seen.opts, { overlay: true, overlayOptions: { width: '100%', maxHeight: '100%', anchor: 'bottom-center' }, blocked: { kind: 'question', message: 'mypi_ask' } });
  assert.equal(short.seen.component.capturesViewportInput, true);
  const shortLines = short.render();
  within(shortLines, 20);
  assert.deepEqual(shortLines.slice(1, -4), ['Факт один.', '', 'Факт два.', '']);
  short.keys('tui.select.confirm');
  assert.deepEqual((await short.result).details, { answer: 'A', custom: false });
  const paragraphs = Array.from({ length: 8 }, (_, index) => `Абзац ${index + 1}: факты о задаче и о том, что из них следует для выбора ответа.`);
  const question = [...paragraphs, 'Слово' + 'о'.repeat(45), '\tс табом', '漢字の行 とても長い 漢字の行'].join('\n\n');
  const lines = wrapQuestion(question, 40);
  const long = open(question);
  const first = long.render();
  within(first, 20);
  assert.equal(first.length, 20);
  assert.equal(first[1], '');
  assert.deepEqual(first.slice(2, 14), lines.slice(0, 12));
  assert.equal(first[14], `↓ ещё ${lines.length - 12} строк`);
  long.keys('tui.editor.cursorRight');
  const second = long.render();
  within(second, 20);
  assert.equal(second[1], '↑ ещё 12 строк');
  assert.equal(second[2], lines[12]);
  assert.ok(long.seen.renders > 0);
  long.keys('tui.editor.cursorRight', 'tui.editor.cursorRight', 'tui.editor.cursorRight', 'tui.editor.cursorRight', 'tui.editor.cursorRight');
  const end = long.render();
  within(end, 20);
  assert.equal(end[14], '— конец вопроса —');
  assert.deepEqual(end.slice(2, 14), lines.slice(-12));
  long.keys('tui.editor.cursorLeft');
  assert.deepEqual(long.render().slice(2, 14), lines.slice(lines.length - 24, lines.length - 12));
  long.keys('tui.select.cancel');
  const cancelled = await long.result;
  assert.deepEqual(cancelled.details, { answer: null, cancelled: true });
  assert.deepEqual(long.inputs, []);
  const paged = open(question);
  paged.render();
  paged.keys('tui.select.pageDown');
  assert.equal(paged.render()[2], lines[12]);
  paged.keys('tui.select.pageUp');
  assert.equal(paged.render()[2], lines[0]);
  paged.keys('tui.select.down', 'tui.select.confirm');
  assert.deepEqual((await paged.result).details, { answer: 'B', custom: false });
  const tiny = open(question, 8);
  const tinyLines = tiny.render();
  within(tinyLines, 8);
  assert.equal(tinyLines[0], '');
  assert.deepEqual(tinyLines.slice(1, 3), lines.slice(0, 2));
  assert.equal(tinyLines[3], `↓ ещё ${lines.length - 2} строк`);
  tiny.keys('tui.select.up', 'tui.select.down', 'tui.select.down', 'unknown');
  assert.deepEqual(tiny.render().slice(-4), ['  A (рекомендую)', '› B', '  Своё слово', tail[3]]);
  tiny.keys('tui.select.up', 'tui.select.confirm');
  assert.deepEqual((await tiny.result).details, { answer: 'A', custom: false });
  for (const rows of [5, 4, 3, 1]) {
    const cramped = open(question, rows);
    const crampedLines = cramped.render();
    assert.ok(crampedLines.length <= rows);
    assert.equal(crampedLines[crampedLines.length - 1], tail[3]);
    for (const line of crampedLines) assert.ok(cellWidth(line) <= 40, line);
    cramped.keys('tui.select.cancel');
    await cramped.result;
  }
  const own = open('Q?', 20, 40, 'tui', [' текст ']);
  own.keys('tui.select.down', 'tui.select.down', 'tui.select.confirm');
  const ownResult = await own.result;
  assert.deepEqual(ownResult.details, { answer: 'текст', custom: true });
  assert.deepEqual(own.inputs, [['Своё слово:', undefined, { signal: own.controller.signal }]]);
  const aborted = open('Q?');
  aborted.controller.abort();
  assert.deepEqual((await aborted.result).details, { answer: null, cancelled: true });
  const rpc = open('Q?', 20, 40, 'rpc', ['B']);
  assert.deepEqual((await rpc.result).details, { answer: 'B', custom: false });
  assert.deepEqual(rpc.selects, [['Q?', ['A (рекомендую)', 'B', 'Своё слово'], { signal: rpc.controller.signal }]]);
  assert.equal(rpc.seen.customs, 0);
});

test('pi extension /open suggests keys of the session\'s project from the CLI', async () => {
  const pi = stub();
  let clock = 1000;
  install(pi.api, root, serve, undefined, process.pid, undefined, () => clock);
  pi.state.key = 'MP-74';
  const projects = { code: 0, killed: false, stderr: '', stdout: JSON.stringify({ projects: [{ id: 1, org: 'yokeloop', slug: 'mypi', code: 'MP' },
    { id: 2, org: 'acme', slug: 'shop', code: 'SH' }] }) };
  const tasks = { code: 0, killed: false, stderr: '', stdout: JSON.stringify([
    { projectId: 1, number: 74, title: 'Completions', status: 'planning', isTerminal: false, key: 'MP-74' },
    { projectId: 2, number: 3, title: 'Cart', status: 'open', isTerminal: false, key: 'SH-3' }]) };
  let taskList: unknown = tasks;
  pi.state.result = (_command, args) => args[1] === 'session' ? pi.registration() : args[1] === 'project' ? projects : args[1] === 'task' ? taskList
    : { code: 0, killed: false, stdout: '# mypi warmup\n', stderr: '' };
  await pi.start('startup');
  const open = pi.commands.get('open')!;
  const lists = () => pi.calls.filter(call => (call[1] as string[])[1] === 'project').length;
  assert.deepEqual(await open.getArgumentCompletions!('MP-'), [{ value: 'MP-74 ', label: 'MP-74', description: 'planning · Completions' }]);
  assert.deepEqual(pi.calls.filter(call => ['project', 'task'].includes((call[1] as string[])[1]!)), [
    ['node', [cli, 'project', 'list'], { cwd: root, timeout: 5000 }], ['node', [cli, 'task', 'list'], { cwd: root, timeout: 5000 }]]);
  await open.getArgumentCompletions!('S');
  assert.equal(lists(), 1);
  clock += 15_000;
  taskList = { code: 1, killed: false, stdout: '', stderr: 'boom' };
  assert.equal(await open.getArgumentCompletions!(''), null);
  assert.equal(lists(), 2);
  taskList = tasks;
  assert.deepEqual((await open.getArgumentCompletions!('') as { label: string }[]).map(item => item.label), ['MP', 'MP-74']);
  assert.equal(lists(), 3);
  assert.deepEqual([...pi.commands.keys()], ['open', 'inbox', 'flow', 'epic']);
  assert.equal(pi.commands.get('inbox')!.getArgumentCompletions, undefined);
});

function sockets(t: TestContext) {
  const run = mkdtempSync(join(tmpdir(), 'mypi-pi-'));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const served: { path: string; stale: boolean }[] = [];
  const batches: ((events: { id: number; text: string }[]) => Promise<number[]>)[] = [];
  const counts = { close: 0 };
  const fake = { refuse: false };
  const serve = async (path: string, onBatch: (events: { id: number; text: string }[]) => Promise<number[]>) => {
    served.push({ path, stale: existsSync(path) });
    if (fake.refuse) throw new Error('EACCES');
    writeFileSync(path, '');
    batches.push(onBatch);
    return { close: async () => { counts.close++; } };
  };
  return { run, served, batches, counts, fake, serve };
}

const settled = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('pi extension opens its event socket for the key, re-registers with it and closes it on every shutdown', async t => {
  const pi = stub();
  const { run, served, counts, serve } = sockets(t);
  install(pi.api, root, serve, run);
  pi.state.key = 'MP';
  const path = join(run, 'mypi', `MP-${process.pid}.sock`);
  mkdirSync(join(run, 'mypi'), { mode: 0o700 });
  writeFileSync(path, 'stale');
  await pi.start('startup');
  assert.deepEqual(pi.calls, [reg('s1'), warm('MP'), reg('s1', '--socket', path)]);
  assert.deepEqual(served, [{ path, stale: false }]);
  assert.equal(statSync(join(run, 'mypi')).mode & 0o777, 0o700);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  await pi.stop('reload');
  assert.equal(counts.close, 1);
  assert.equal(existsSync(path), false);
  assert.equal(pi.calls.length, 3);
  await pi.start('reload');
  assert.deepEqual(pi.calls.slice(3), [reg('s1'), reg('s1', '--socket', path)]);
  assert.equal(served.length, 2);
  writeFileSync(path + '.new', 'other');
  renameSync(path + '.new', path);
  await pi.stop('new');
  assert.equal(counts.close, 2);
  assert.equal(existsSync(path), true);
  rmSync(path);
  pi.state.header = { parentSession: '/p.jsonl' };
  await pi.start('startup');
  assert.deepEqual(pi.calls.slice(5), [reg('s1', '--fork'), reg('s1', '--fork', '--socket', path)]);
  await pi.stop('quit');
  assert.equal(counts.close, 3);
  assert.equal(existsSync(path), false);
  assert.deepEqual(pi.calls.at(-1), ['node', [cli, 'session', 'unregister', '--pid', String(process.pid)], { cwd: root, timeout: 5000 }]);
});

test('pi extension subscribes from session_start after the socket and aborts on shutdown', async t => {
  const pi = stub();
  const { run, serve } = sockets(t);
  const runs: { args: string[]; signal: AbortSignal; after: unknown[] }[] = [];
  const fake: RunCli = (args, { signal }) => {
    runs.push({ args, signal, after: pi.calls.at(-1)! });
    return new Promise(resolve => signal.addEventListener('abort', () => resolve({ code: 0, signal: null, stdout: '', stderr: '' })));
  };
  install(pi.api, root, serve, run, process.pid, fake);
  pi.state.key = 'MP';
  const path = join(run, 'mypi', `MP-${process.pid}.sock`);
  await pi.start('startup');
  assert.deepEqual(runs.map(r => r.args), [[cli, 'session', 'subscribe', '--pid', String(process.pid)]]);
  assert.deepEqual(runs[0]!.after, reg('s1', '--socket', path));
  await pi.start('reload');
  assert.equal(runs.length, 2);
  assert.deepEqual([runs[0]!.signal.aborted, runs[1]!.signal.aborted], [true, false]);
  await pi.stop('quit');
  assert.equal(runs[1]!.signal.aborted, true);
});

test('pi extension gives each process its own socket', async t => {
  const { run } = sockets(t);
  const served: string[] = [];
  const serve = async (path: string) => {
    served.push(path);
    writeFileSync(path, '');
    return { close: async () => { rmSync(path, { force: true }); } };
  };
  const a = stub(), b = stub();
  install(a.api, root, serve, run, 101);
  install(b.api, root, serve, run, 102);
  a.state.key = b.state.key = 'MP';
  b.state.id = 's2';
  await a.start('startup');
  await b.start('startup');
  assert.deepEqual(served, [join(run, 'mypi', 'MP-101.sock'), join(run, 'mypi', 'MP-102.sock')]);
  assert.deepEqual(b.calls.at(-1), ['node', [cli, 'session', 'register', '--agent', 'pi', '--pid', '102', '--native-id', 's2', '--socket', served[1]],
    { cwd: root, timeout: 5000 }]);
  await a.stop('quit');
  assert.equal(existsSync(served[0]!), false);
  assert.equal(existsSync(served[1]!), true);
  assert.deepEqual(a.calls.at(-1), ['node', [cli, 'session', 'unregister', '--pid', '101'], { cwd: root, timeout: 5000 }]);
});

test('pi extension marks only interactive input', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  const input = (source: string) => (pi.handlers.get('input') as unknown as (event: { text: string; source: string }) => Promise<unknown>)({ text: 'hi', source });
  assert.deepEqual(await input('interactive'), { action: 'continue' });
  assert.deepEqual(pi.calls, []);
  pi.state.key = 'MP';
  await pi.start('startup');
  const before = pi.calls.length;
  assert.deepEqual(await input('interactive'), { action: 'continue' });
  assert.deepEqual(pi.calls.slice(before), [
    ['node', [cli, 'session', 'prompt', '--agent', 'pi', '--native-id', 's1', '--no-deliver'], { cwd: root, timeout: 2000 }],
    ['node', [cli, 'session', 'prompt', '--agent', 'pi', '--native-id', 's1'], { cwd: root, timeout: 5000 }]]);
  for (const source of ['extension', 'rpc']) assert.deepEqual(await input(source), { action: 'continue' });
  assert.equal(pi.calls.length, before + 2);
});

const delivery = ['node', [cli, 'session', 'prompt', '--agent', 'pi', '--native-id', 's1'], { cwd: root, timeout: 5000 }];
const pointerAnswer = (answer: () => unknown) => (_command: string, args: string[]): unknown =>
  args.includes('--no-deliver') ? answer() : new Promise<never>(() => {});

test('pi extension waits only for the pointer call and never for delivery', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  const input = (source: string) => (pi.handlers.get('input') as unknown as (event: { text: string; source: string }) => Promise<unknown>)({ text: 'hi', source });
  pi.state.key = 'MP';
  await pi.start('startup');
  pi.state.result = pointerAnswer(() => ({ code: 0, killed: false, stdout: '', stderr: '' }));
  let waiting: Promise<unknown> = Promise.resolve();
  for (let i = 0; i < 50; i++) waiting = waiting.then(() => undefined);
  assert.deepEqual(await Promise.race([input('interactive'), waiting.then(() => 'still waiting')]), { action: 'continue' });
  assert.deepEqual(pi.calls.at(-2), ['node', [cli, 'session', 'prompt', '--agent', 'pi', '--native-id', 's1', '--no-deliver'], { cwd: root, timeout: 2000 }]);
  assert.deepEqual(pi.calls.at(-1), delivery);
});

test('pi extension puts the pointer before the text and after a slash command', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  const input = (text: string, images?: unknown[]) => (pi.handlers.get('input') as unknown as
    (event: { text: string; source: string; images?: unknown[] }) => Promise<unknown>)({ text, source: 'interactive', ...(images === undefined ? {} : { images }) });
  pi.state.key = 'MP';
  await pi.start('startup');
  const line = pointerLine({ key: 'MP', agent: 'claude', device: 'laptop', entries: 1, commits: null });
  pi.state.result = pointerAnswer(() => ({ code: 0, killed: false, stdout: line + '\n', stderr: '' }));
  assert.deepEqual(await input('привет'), { action: 'transform', text: line + '\n\nпривет' });
  assert.deepEqual(pi.calls.at(-1), delivery);
  assert.deepEqual(await input('/skill:review x'), { action: 'transform', text: '/skill:review x\n\n' + line });
  const images = [{ type: 'image', data: 'a', mimeType: 'image/png' }];
  assert.deepEqual(await input('привет', images), { action: 'transform', text: line + '\n\nпривет', images });
});

test('pi extension continues when the pointer call fails', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  const input = () => (pi.handlers.get('input') as unknown as (event: { text: string; source: string }) => Promise<unknown>)({ text: 'hi', source: 'interactive' });
  pi.state.key = 'MP';
  await pi.start('startup');
  const line = pointerLine({ key: 'MP', agent: 'claude', device: 'laptop', entries: 1, commits: null });
  const answers: (() => unknown)[] = [
    () => ({ code: 1, killed: false, stdout: line, stderr: '' }),
    () => ({ code: 0, killed: true, stdout: line, stderr: '' }),
    () => ({ code: 0, killed: false, stdout: '{"key":"MP"}', stderr: '' }),
    () => Promise.reject(new Error('boom')),
  ];
  for (const answer of answers) {
    const before = pi.calls.length;
    pi.state.result = pointerAnswer(answer);
    assert.deepEqual(await input(), { action: 'continue' });
    assert.deepEqual(pi.calls.slice(before).at(-1), delivery);
    assert.equal(pi.calls.length, before + 2);
  }
});

test('pi extension warns when its event socket cannot open and does not register a socket', async t => {
  const pi = stub();
  const { run, fake, serve } = sockets(t);
  install(pi.api, root, serve, run);
  pi.state.key = 'MP';
  fake.refuse = true;
  await pi.start('startup');
  assert.deepEqual(pi.calls, [reg('s1'), warm('MP')]);
  assert.deepEqual(pi.notes, [['mypi event socket failed: EACCES', 'warning']]);
});

test('pi extension injects a batch as one follow-up, waits for the turn to start when idle and acknowledges repeats once', async t => {
  const pi = stub();
  const { run, batches, serve } = sockets(t);
  install(pi.api, root, serve, run);
  pi.state.key = 'MP';
  await pi.start('startup');
  assert.equal(statSync(join(run, 'mypi')).mode & 0o777, 0o700);
  const batch = batches[0]!;
  const agentStart = () => pi.handlers.get('agent_start')!(undefined, pi.ctx);
  const follow = { deliverAs: 'followUp' };
  let first: number[] | undefined;
  void batch([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]).then(ids => { first = ids; });
  await settled();
  assert.deepEqual(pi.sent, [['a\n\nb', follow]]);
  assert.equal(first, undefined);
  await agentStart();
  await settled();
  assert.deepEqual(first, [1, 2]);
  assert.deepEqual(await batch([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]), [1, 2]);
  assert.equal(pi.sent.length, 1);
  pi.state.idle = false;
  assert.deepEqual(await batch([{ id: 2, text: 'b' }, { id: 3, text: 'c' }]), [2, 3]);
  assert.deepEqual(pi.sent.at(-1), ['c', follow]);
  pi.state.idle = true;
  const acked: number[][] = [];
  void batch([{ id: 4, text: 'd' }]).then(ids => { acked.push(ids); });
  void batch([{ id: 5, text: 'e' }]).then(ids => { acked.push(ids); });
  await settled();
  assert.deepEqual(pi.sent.slice(2), [['d', follow]]);
  await agentStart();
  await settled();
  assert.deepEqual(pi.sent.slice(2), [['d', follow], ['e', follow]]);
  assert.deepEqual(acked, [[4], [5]]);
});

test('pi extension recognises the parent-message frame by the same pattern as the engine', () => {
  const literal = (path: string, prefix: string) => {
    const line = readFileSync(join(root, path), 'utf8').split('\n').find(l => l.startsWith(prefix));
    assert.ok(line !== undefined, path);
    return line.slice(prefix.length);
  };
  assert.equal(literal('.pi/extensions/mypi-lib/install.ts', 'const PARENT_MESSAGE = '),
    literal('src/modules/events/public.ts', 'export const PARENT_MESSAGE = '));
});

test('pi extension refuses an unbuilt engine', () => {
  const pi = stub();
  assert.throws(() => install(pi.api, join(root, 'missing'), serve, undefined), /mypi is not built/);
  assert.deepEqual(pi.servers, []);
  assert.equal(pi.handlers.size, 0);
});

test('pi extension keeps its socket in TMPDIR on macOS without XDG_RUNTIME_DIR', () => {
  const tmp = () => '/tmp/x';
  assert.equal(runtimeDir({}, 'darwin', tmp), '/tmp/x');
  assert.equal(runtimeDir({ XDG_RUNTIME_DIR: '' }, 'darwin', tmp), '/tmp/x');
  assert.equal(runtimeDir({ XDG_RUNTIME_DIR: '/run/user/1' }, 'darwin', tmp), '/run/user/1');
  assert.equal(runtimeDir({}, 'linux', tmp), undefined);
  assert.equal(runtimeDir({ XDG_RUNTIME_DIR: '/run/user/1' }, 'linux', tmp), '/run/user/1');
});
