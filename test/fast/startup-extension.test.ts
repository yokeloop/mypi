import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import install from '../../src/app/startup-extension.js';
import { parseCommand } from '../../src/cli/command.js';
import { appCommand } from '../../src/cli/app-command.js';

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
  const preview = { action: 'resume', chatId: 'chat-1',
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
test('managed flags applied after extension loading produce native lifecycle acknowledgements without replaying model choice', async () => {
  const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<void> | void>>();
  const flags = new Map<string, unknown>();
  const reports: Array<{ lifecycle: string; attempt: string; model: { provider: string; model: string }; sessionId: string; finalEmpty: boolean; error?: string }> = [];
  const branch: any[] = [];
  const attempt = '11111111-2222-4333-8444-555555555555';
  const root = process.cwd();
  let sessionId = 'first-session';
  let selected = { provider: 'fixture', id: 'initial' };
  let selections = 0;
  const api = {
    registerMcpServer() {}, registerCommand() {}, registerFlag() {},
    getFlag(name: string) { return flags.get(name); },
    on(name: string, handler: (event: any, ctx: any) => Promise<void> | void) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    appendEntry(_name: string, value: unknown) { branch.push({ type: 'custom', customType: 'mypi-startup-binding', data: value }); },
    async setModel(model: { provider: string; id: string }) {
      selections++;
      branch.push({ type: 'model_change', provider: model.provider, modelId: model.id });
      return true;
    },
    async exec(_command: string, args: string[]) {
      if (args[0]?.endsWith('/work-chat-ack.js')) {
        reports.push(JSON.parse(args[3]!) as (typeof reports)[number]);
        return { code: 0, killed: false, stdout: '', stderr: '' };
      }
      return { code: 0, killed: false, stdout: JSON.stringify({ memory: [], work: { tasks: [] } }), stderr: '' };
    },
  };
  install(api as never); // Pi loads extensions before it applies CLI flag values.
  const ctx = { cwd: root, signal: new AbortController().signal, hasUI: false,
    get model() { return selected; },
    modelRegistry: { find(provider: string, id: string) { return { provider, id }; }, hasConfiguredAuth() { return true; } },
    sessionManager: { getSessionId: () => sessionId, getSessionFile: () => undefined,
      getHeader: () => ({ id: sessionId, cwd: root }), getEntries: () => [], getBranch: () => branch },
  };
  const emit = async (name: string, event: any = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
  };
  await emit('session_start', { reason: 'startup' });
  assert.equal(reports.length, 0, 'unmanaged sessions must not emit native acknowledgements');
  flags.set('mypi-chat-attempt', attempt);
  flags.set('mypi-chat-model', JSON.stringify({ provider: 'fixture', model: 'initial' }));
  flags.set('mypi-chat-override', true);
  flags.set('mypi-scope', 'fixture/tool');
  await emit('session_start', { reason: 'startup' });
  assert.equal(reports.at(-1)?.lifecycle, 'start:startup');
  assert.equal(reports.at(-1)?.attempt, attempt);
  assert.equal(reports.at(-1)?.error, undefined);
  assert.equal(selections, 1, 'explicit resume override persists exactly once at startup');
  selected = { provider: 'fixture', id: 'manual' };
  branch.push({ type: 'model_change', provider: 'fixture', modelId: 'manual' });
  await emit('model_select');
  assert.deepEqual(reports.at(-1)?.model, { provider: 'fixture', model: 'manual' });
  await emit('session_start', { reason: 'reload' });
  assert.equal(reports.at(-1)?.lifecycle, 'start:reload');
  assert.equal(selections, 1, 'reload must preserve the manual choice');
  sessionId = 'changed-session';
  await emit('session_tree');
  assert.equal(reports.at(-1)?.sessionId, 'changed-session', 'native identity changes must remain observable');
  await emit('session_shutdown', { reason: 'quit' });
  assert.equal(reports.at(-1)?.finalEmpty, true, 'shutdown reports the real final empty snapshot');
  flags.set('mypi-chat-model', '{invalid');
  await emit('session_start', { reason: 'startup' });
  assert.equal(reports.at(-1)?.lifecycle, 'start:startup');
  assert.match(reports.at(-1)?.error ?? '', /model/i, 'malformed late target cannot be acknowledged as ready');
  assert.equal(selections, 1);
});
test('model-less native startup is an auth-pending receipt; login model_select reports local readiness in same session', async () => {
  const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<void> | void>>();
  const flags = new Map<string, unknown>([
    ['mypi-chat-attempt', '11111111-2222-4333-8444-555555555555'],
    ['mypi-chat-model', JSON.stringify({ provider: 'fixture', model: 'chosen' })],
    ['mypi-chat-unpinned', true],
    ['mypi-scope', 'fixture/tool'],
  ]);
  const reports: any[] = [];
  let model: { provider: string; id: string } | undefined = { provider: 'unknown', id: 'unknown' };
  let auth = false;
  const api = { registerMcpServer() {}, registerCommand() {}, registerFlag() {},
    getFlag(name: string) { return flags.get(name); },
    on(name: string, handler: (event: any, ctx: any) => Promise<void> | void) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    async exec(_command: string, args: string[]) {
      if (args[0]?.endsWith('/work-chat-ack.js')) reports.push(JSON.parse(args[3]!));
      return { code: 0, killed: false, stderr: '', stdout: '' };
    },
  };
  install(api as never);
  const ctx = { cwd: process.cwd(), signal: new AbortController().signal, hasUI: false, get model() { return model; },
    modelRegistry: { find(provider: string, id: string) { return provider === 'unknown' ? undefined : { provider, id }; }, hasConfiguredAuth() { return auth; } },
    sessionManager: { getSessionId: () => 'same-session', getSessionFile: () => undefined,
      getHeader: () => ({ id: 'same-session', cwd: process.cwd() }), getEntries: () => [], getBranch: () => [] },
  };
  const emit = async (name: string, event: any = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
  };
  await emit('session_start', { reason: 'startup' });
  assert.equal(reports.at(-1).lifecycle, 'start:startup');
  assert.equal(reports.at(-1).model, undefined);
  assert.equal(reports.at(-1).authReady, false);
  assert.equal(reports.at(-1).error, undefined);
  flags.delete('mypi-chat-unpinned');
  await emit('session_start', { reason: 'startup' });
  assert.match(reports.at(-1).error, /absent from registry/, 'unregistered model is not accepted in a pinned launch');
  flags.set('mypi-chat-unpinned', true);
  model = { provider: 'fixture', id: 'automatic' }; auth = true;
  await emit('model_select');
  assert.equal(reports.at(-1).sessionId, 'same-session');
  assert.equal(reports.at(-1).model.model, 'automatic');
  model = { provider: 'fixture', id: 'chosen' };
  await emit('model_select');
  assert.equal(reports.at(-1).model.model, 'chosen');
  assert.equal(reports.at(-1).authReady, true);
  model = { provider: 'fixture', id: 'automatic' };
  flags.set('mypi-chat-unpinned', true);
  await emit('session_start', { reason: 'startup' });
  assert.equal(reports.at(-1).model.model, 'automatic');
  assert.equal(reports.at(-1).authReady, true);
  assert.equal(reports.at(-1).error, undefined, 'unrelated authenticated default may start an unpinned pending tab');
  flags.delete('mypi-chat-unpinned');
  await emit('session_start', { reason: 'startup' });
  assert.match(reports.at(-1).error, /another model/, 'pinned launches still enforce the exact target');
  flags.set('mypi-chat-unpinned', true);
  flags.set('mypi-chat-override', true);
  await emit('session_start', { reason: 'startup' });
  assert.equal(reports.at(-1).error, undefined, 'pending resume must not persist or reject another authenticated model');
  assert.equal(reports.at(-1).model.model, 'automatic');
  model = { provider: 'fixture', id: 'chosen' };
  await emit('model_select');
  assert.equal(reports.at(-1).sessionId, 'same-session');
  assert.equal(reports.at(-1).model.model, 'chosen');
  assert.equal(reports.at(-1).error, undefined);
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
