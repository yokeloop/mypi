import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { TestContext } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEMODE_GUIDELINE, install, isEscape } from '../../.pi/extensions/mypi-lib/install.js';
import type { RunCli } from '../../.pi/extensions/mypi-lib/install.js';
import { frame, parentFrame, startFrame } from '../../src/modules/events/public.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const description = 'Local mypi tools for projects, tasks, history and knowledge. No automatic initialization or writes.';
const cli = join(root, 'dist/src/cli/main.js');
const reg = (id: string, ...extra: string[]) => ['node', [cli, 'session', 'register', '--agent', 'pi', '--pid', String(process.pid), '--native-id', id, ...extra], { cwd: root, timeout: 5000 }];
const serve = async () => ({ close: async () => {} });
const warm = (key: string) => ['node', [cli, 'warmup', '-s', key], { cwd: root, timeout: 5000 }];

function stub() {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<void> | void>();
  const servers: { name: string; config: any }[] = [], removed: string[] = [], calls: unknown[][] = [], sent: unknown[][] = [];
  const notes: [string, string][] = [];
  const compactions: any[] = [];
  const statuses: [string, string | undefined][] = [];
  const inputs: ((data: string) => { consume?: boolean; data?: string } | undefined)[] = [];
  const terminal = { unsubscribed: 0 };
  const commands = new Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void>; getArgumentCompletions?: (prefix: string) => Promise<unknown> }>();
  const tools = new Map<string, any>();
  const registration = () => ({ code: 0, killed: false, stdout: JSON.stringify({ key: state.key, registered: true, displaced: null }) + '\n', stderr: '' });
  const state = { id: 's1', key: 'global', idle: true, name: undefined as string | undefined, file: undefined as string | undefined, header: null as { parentSession?: string } | null,
    result: (_command: string, args: string[]): unknown => args[1] === 'session' ? registration() : { code: 0, killed: false, stdout: '', stderr: '' } };
  const api = {
    on(name: string, handler: (event: any, ctx: any) => Promise<void> | void) { handlers.set(name, handler); },
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
    compact(options: any) { compactions.push(options); },
    sessionManager: { getSessionId: () => state.id, getSessionName: () => state.name, getSessionFile: () => state.file, getHeader: () => state.header } };
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
    options, registration, compactions };
}

test('pi extension registers mypi MCP with the session id and loads warmup into every turn', async () => {
  const pi = stub();
  install(pi.api, root, serve, undefined);
  assert.equal(pi.servers.length, 0);
  assert.deepEqual(pi.calls, []);
  assert.deepEqual([...pi.handlers.keys()].sort(), ['agent_end', 'agent_settled', 'agent_start', 'before_agent_start', 'session_shutdown', 'session_start', 'ui_prompt_start']);
  assert.deepEqual([...pi.commands.keys()], ['open', 'inbox', 'flow', 'epic']);
  assert.deepEqual([...pi.tools.keys()], ['mypi_ask', 'mypi_compact']);
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

test('pi extension gives each process its own socket so a displaced session never removes the new one', async t => {
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

test('pi extension holds an event batch while compacting', async t => {
  const pi = stub();
  const { run, batches, serve } = sockets(t);
  install(pi.api, root, serve, run);
  pi.state.key = 'MP';
  pi.state.result = (command, args) => command === 'git' ? { code: 0, killed: false, stdout: '', stderr: '' }
    : command === 'bash' ? { code: 0, killed: false, stdout: '', stderr: '' }
    : args[1] === 'task' ? { code: 0, killed: false, stdout: JSON.stringify({ contextDir: 'projects/yokeloop/mypi/tasks/MP-1-one' }), stderr: '' }
    : args[1] === 'session' ? pi.registration() : { code: 0, killed: false, stdout: '', stderr: '' };
  await pi.start('startup');
  const result = await pi.tools.get('mypi_compact').execute('call-1', { key: 'MP-1', resume: '/flow fx MP-1', focus: 'next' });
  assert.equal(result.terminate, true);
  await pi.handlers.get('agent_settled')!(undefined, pi.ctx);
  assert.equal(pi.compactions.length, 1);
  let acked: number[] | undefined;
  void batches[0]!([{ id: 1, text: 'a' }]).then(ids => { acked = ids; });
  await settled();
  assert.equal(pi.sent.some(entry => entry[0] === 'a'), false);
  assert.equal(acked, undefined);
  pi.compactions[0].onError(new Error('Nothing to compact (session too small)'));
  await settled();
  assert.deepEqual(pi.sent, [['/skill:flow fx MP-1', { deliverAs: 'followUp', expandPromptTemplates: true }], ['a', { deliverAs: 'followUp' }]]);
  await pi.handlers.get('agent_start')!(undefined, pi.ctx);
  await settled();
  assert.deepEqual(acked, [1]);
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
