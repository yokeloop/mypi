import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import registerStartupExtension, { type ExtensionAPI } from '../../src/app/startup-registration.js';
import { parseCommand } from '../../src/cli/command.js';
import { appCommand } from '../../src/cli/app-command.js';

function install(api: ExtensionAPI): void {
  registerStartupExtension(api, (cli, args, options) => api.exec('node', [cli, ...args], options));
}

// Exercise the actual extension handlers without a Pi process or external CLI.
test('native slash execute forwards exact saved-session preview JSON and focus to shared CLI parsing', async () => {
  let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
  const calls: string[][] = [];
  const notices: string[] = [];
  install({ registerMcpServer() {}, registerFlag() {}, on() {},
    registerCommand(name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) {
      if (name === 'work-chat') handler = command.handler;
    },
    async exec(_command: string, argv: string[]) {
      calls.push(argv);
      return { code: 0, stdout: '{}', stderr: '' };
    },
  } as never);
  assert(handler, 'registered native command must be exercised');
  const ctx = { signal: new AbortController().signal, ui: { notify(message: string) { notices.push(message); } } };
  const preview = { action: 'resume', chatId: 'chat-1', priorAttempt: 'attempt-1', priorRevision: 'a'.repeat(64),
    binding: { projectId: 1, requestId: 2, sourceClone: '/source', worktree: '/worktree',
      gitCommonDir: '/source/.git', branch: 'task/a', installation: '/engine', statePath: '/state' },
    model: { provider: 'fixture', model: 'model/id', source: 'saved session' },
    native: { sessionId: 'session-1', historyPath: '/state/sessions/a.jsonl' },
    name: 'marker with spaces, escaped "quotes" and \\slashes --focus',
  };
  const json = JSON.stringify(preview);
  const cli = async (input: string) => {
    await handler!(input, ctx);
    return calls.at(-1)!.slice(1);
  };
  const argv = await cli(`execute --preview ${json} --focus`);
  assert.deepEqual(argv, ['work-chat', 'execute', '--preview', json, '--focus']);
  assert.deepEqual(appCommand(parseCommand(argv) as Exclude<ReturnType<typeof parseCommand>, { type: 'help' }>),
    { name: 'work_chat_execute', preview, focus: true });
  const noFocus = await cli(`execute --preview ${json}`);
  assert.deepEqual(noFocus, ['work-chat', 'execute', '--preview', json]);
  assert.equal((appCommand(parseCommand(noFocus) as Exclude<ReturnType<typeof parseCommand>, { type: 'help' }>) as { focus?: boolean }).focus, false);
  const embeddedFocus = JSON.stringify({ ...preview, name: 'suffix --focus' });
  assert.deepEqual(await cli(`execute --preview ${embeddedFocus}`), ['work-chat', 'execute', '--preview', embeddedFocus]);
  const formatted = JSON.stringify(preview, null, 2);
  const leadingFocus = await cli(`execute --focus --preview ${formatted}`);
  assert.deepEqual(leadingFocus, ['work-chat', 'execute', '--focus', '--preview', formatted]);
  assert.equal((appCommand(parseCommand(leadingFocus) as Exclude<ReturnType<typeof parseCommand>, { type: 'help' }>) as { focus?: boolean }).focus, true);
  for (const input of ['execute --preview', 'execute --preview {invalid',
    `execute --preview ${json} extra`, `execute --preview ${json} --preview ${json}`,
    `execute --preview ${json} --focus --focus`, `execute --preview ${json}--focus`]) {
    const forwarded = await cli(input);
    assert.throws(() => appCommand(parseCommand(forwarded) as Exclude<ReturnType<typeof parseCommand>, { type: 'help' }>));
  }
  assert.deepEqual(await cli('list'), ['work-chat', 'list']);
  assert.equal(notices.length, calls.length);
});
test('session snapshot survives ordinary turns/compaction, refreshes on memory tools and lifecycle, rejects late reads', async t => {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<void> | void>();
  const entries: any[] = [];
  const calls: string[][] = [];
  let scope: string | undefined = 'global';
  let session = 'one';
  let defer = false;
  let complete: ((value: any) => void) | undefined;
  const result = { code: 0, killed: false, stdout: JSON.stringify({ memory: [{ path: 'MEMORY.md', text: 'fact' }], work: { tasks: [] } }), stderr: '' };
  const root = process.cwd();
  const aliasDir = mkdtempSync(join(tmpdir(), 'mypi-root-alias-'));
  t.after(() => rmSync(aliasDir, { recursive: true, force: true }));
  const alias = join(aliasDir, 'root'); symlinkSync(root, alias);
  const api = {
    registerMcpServer() {}, registerCommand() {}, registerFlag() {}, getFlag(name: string) { return name === 'mypi-scope' ? scope : false; },
    on(name: string, handler: (event: any, ctx: any) => Promise<void> | void) { handlers.set(name, handler); },
    appendEntry(_name: string, value: unknown) { entries.push({ type: 'custom', customType: 'mypi-startup-binding', data: value }); },
    exec(_command: string, args: string[]) {
      calls.push(args);
      if (defer) { defer = false; return new Promise(resolve => { complete = resolve; }); }
      return Promise.resolve(result);
    },
  };
  install(api as never);
  const ctx = { cwd: alias, signal: new AbortController().signal, hasUI: false,
    sessionManager: { getSessionId: () => session, getBranch: () => entries } };
  const emit = (name: string, event: any = {}, context: any = ctx) => handlers.get(name)!(event, context);
  const turn = async () => {
    const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
    await emit('before_agent_start', event);
    return event.systemPromptOptions.sections;
  };
  await emit('session_start');
  assert.match((await turn()).mypi_memory!, /fact/);
  assert.deepEqual(calls.map(c => c[1]), ['warmup'], 'symlink to root must not call project resolve');
  assert.equal(calls[0]!.length, 2, 'explicit global must not become organization global');
  assert.equal(entries.length, 1);
  await turn(); await turn(); // Compaction changes neither session nor branch; next turn reuses the snapshot.
  assert.equal(calls.length, 1);
  await emit('tool_call', { toolName: 'mcp_mypi_memory_show', input: {} });
  await emit('tool_result', { toolName: 'mcp_mypi_memory_show', input: {} });
  await turn(); assert.equal(calls.length, 2);
  await emit('tool_result', { toolName: 'bash', input: { command: 'mypi memory remove 1 --expected-revision a' }, isError: true });
  await turn(); assert.equal(calls.length, 3, 'failed/partial write invalidates');
  await emit('tool_execution_start', { toolName: 'mcp__mypi__memory_add', args: { text: 'new' } });
  await emit('tool_execution_end', { toolName: 'mcp__mypi__memory_add', isError: true });
  await turn(); assert.equal(calls.length, 4, 'nested MCP write invalidates on partial failure');
  await emit('user_bash', { command: 'mypi memory show' });
  await turn(); assert.equal(calls.length, 5);
  await emit('session_tree'); await turn(); assert.equal(calls.length, 6);
  for (const reason of ['reload', 'resume', 'fork', 'new']) {
    await emit('session_start', { reason });
    await turn();
  }
  assert.equal(calls.length, 10, 'each native lifecycle start refreshes the current branch');
  entries.length = 0; session = 'two'; scope = 'global';
  await emit('session_start');
  const outside = { ...ctx, cwd: aliasDir };
  const explicitTurn = { systemPromptOptions: { sections: {} as Record<string, string> } };
  await emit('before_agent_start', explicitTurn, outside);
  assert.deepEqual(calls.at(-1)!.slice(1), ['warmup'], 'explicit global outside root uses global warmup');
  assert.match(explicitTurn.systemPromptOptions.sections.mypi_memory!, /fact/);
  entries.length = 0; session = 'three'; scope = undefined;
  await emit('session_start');
  defer = true;
  const oldTurn = turn();
  await Promise.resolve(); await Promise.resolve();
  assert(complete, 'warmup must be in flight');
  session = 'four'; await emit('session_start');
  complete(result); await oldTurn;
  assert.equal(entries.length, 0, 'departed session must not bind or install snapshot');
  await turn(); assert.equal(calls.length, 13);
});


test('slash open-request forwards one shared command and displays opening, selection and error without retry', async () => {
  let command!: (args: string, ctx: any) => Promise<void>;
  const calls: string[][] = [], notices: string[] = [];
  let response = { code: 0, stdout: JSON.stringify({ outcome: 'opened', chat: { id: 'chat' } }), stderr: '' };
  install({ registerMcpServer() {}, registerFlag() {}, on() {},
    registerCommand(_name: string, value: { handler: typeof command }) { command = value.handler; },
    async exec(_binary: string, args: string[]) {
      calls.push(args);
      try {
        const parsed = parseCommand(args.slice(1));
        assert.notEqual(parsed.type, 'help'); appCommand(parsed as Exclude<typeof parsed, { type: 'help' }>);
      }
      catch (error) { return { code: 1, stdout: '', stderr: JSON.stringify({ status: 'error', message: (error as Error).message }) }; }
      return response;
    },
  } as never);
  const ctx = { signal: new AbortController().signal, ui: { notify(text: string) { notices.push(text); } } };
  await command('open-request --project one/project --request-id 2', ctx);
  assert.deepEqual(calls[0]!.slice(1), ['work-chat', 'open-request', '--project', 'one/project', '--request-id', '2']);
  assert.equal(JSON.parse(notices.at(-1)!).outcome, 'opened');
  response = { code: 1, stdout: '', stderr: JSON.stringify({ status: 'error', outcome: 'choice-needed', chats: [{ id: 'a' }, { id: 'b' }], reason: 'Select chatId' }) };
  await command('open-request --project one/project --request-id 2', ctx);
  assert.deepEqual(JSON.parse(notices.at(-1)!).chats, [{ id: 'a' }, { id: 'b' }]);
  response = { code: 1, stdout: '', stderr: JSON.stringify({ status: 'error', message: 'Exact native history unavailable' }) };
  await command('open-request --project one/project --request-id 2 --chat-id a', ctx);
  assert.match(notices.at(-1)!, /Exact native history unavailable/);
  await command('adopt-model', ctx);
  assert.match(notices.at(-1)!, /removed.*native \/model.*same Pi session/);
  assert.equal(calls.length, 4, 'no hidden launch, sync, adoption or retry');
  await command('help', ctx);
  assert.equal(calls.length, 4);
  assert.match(notices.at(-1)!, /open-request.*open\/focus now.*only preview.*read-only/);
});

test('native lifecycle no longer mirrors auth/model; independent MCP, scope and warmup guards remain', async () => {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<void> | void>();
  const flags: string[] = [], calls: string[][] = [], servers: any[] = [], entries: any[] = [];
  let disabled = false;
  install({
    registerMcpServer(name: string, server: unknown) { servers.push({ name, server }); },
    registerCommand() {}, registerFlag(name: string) { flags.push(name); },
    getFlag(name: string) { return name === 'mypi-scope' ? 'one/project' : disabled; },
    on(name: string, handler: (event: any, ctx: any) => Promise<void> | void) { handlers.set(name, handler); },
    appendEntry(name: string, data: unknown) { entries.push({ type: 'custom', customType: name, data }); },
    async exec(_binary: string, args: string[]) { calls.push(args); return { code: 0, stdout: '{"memory":[],"work":{"tasks":[]}}', stderr: '' }; },
  } as never);
  assert.deepEqual(flags.sort(), ['mypi-no-autoload', 'mypi-scope']);
  assert.equal(servers[0].name, 'mypi');
  assert.deepEqual(servers[0].server.toolExposure, { project_resolve: 'direct', warmup: 'direct' });
  assert.equal(handlers.has('model_select'), false, 'Pi model/login changes need no synchronization');
  const ctx = { cwd: process.cwd(), signal: new AbortController().signal, hasUI: false,
    get model() { throw new Error('Native model must not be read by mypi'); },
    get modelRegistry() { throw new Error('Auth must not be read by mypi'); },
    sessionManager: { getSessionId: () => 'native', getBranch: () => entries } };
  const emit = async (name: string, event: any = {}) => { await handlers.get(name)?.(event, ctx); };
  for (const name of ['session_start', 'session_tree', 'session_shutdown']) await emit(name);
  assert.equal(calls.length, 0, 'lifecycle invalidates only: no ack, warmup-at-start, watcher or model action');
  await emit('session_start');
  const turn = async () => {
    const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
    await emit('before_agent_start', event);
    return event.systemPromptOptions.sections;
  };
  assert.match((await turn()).mypi_memory!, /scope: one\/project/);
  assert.deepEqual(calls[0]!.slice(1), ['warmup', '-s', 'one/project']);
  const saved = { ...entries[0].data };
  for (const change of [{ installation: '/foreign' }, { state: '/foreign' }, { scope: 'other/project' }]) {
    entries[0].data = { ...saved, ...change }; await emit('session_start');
    assert.match((await turn()).mypi_memory!, /context unavailable/);
  }
  assert.equal(calls.length, 1, 'conflicting saved binding never reads another scope');
  entries[0].data = saved;
  disabled = true; await emit('session_start'); assert.deepEqual(await turn(), {});
  assert.equal(calls.length, 1, 'autoload opt-out remains independent of MCP registration');
});

test('slash keeps the finite CLI boundary and reports interruption or spawn failure without retry', async () => {
  let handler!: (args: string, ctx: any) => Promise<void>;
  const notices: string[] = [];
  let calls = 0;
  registerStartupExtension({ registerMcpServer() {}, registerFlag() {}, on() {},
    registerCommand(_name: string, command: { handler: typeof handler }) { handler = command.handler; },
  } as never, async (cli, args, options) => {
    calls++;
    assert.equal(cli, join(process.cwd(), 'dist/src/cli/main.js'));
    assert.deepEqual(args, ['work-chat', 'list']);
    assert.equal(options.cwd, process.cwd()); assert.equal(options.timeout, 30000);
    assert.equal(options.signal, undefined, 'idle Pi commands may have no operation signal');
    if (calls === 2) throw new Error('spawn unavailable');
    return { code: 0, killed: true, stdout: 'not success', stderr: 'cancelled' };
  });
  const ctx = { ui: { notify(text: string) { notices.push(text); } } };
  await handler('list', ctx); await handler('list', ctx);
  assert.deepEqual(notices, ['cancelled', 'work-chat command failed: spawn unavailable']);
  assert.equal(calls, 2);
});
