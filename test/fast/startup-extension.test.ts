import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import registerStartupExtension, { type ExtensionAPI } from '../../src/app/startup-registration.js';

function install(api: ExtensionAPI): void {
  registerStartupExtension(api);
}

// Exercise the actual extension handlers without a Pi process or external CLI.
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
    registerMcpServer() {}, registerFlag() {}, getFlag(name: string) { return name === 'mypi-scope' ? scope : false; },
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

test('native lifecycle no longer mirrors auth/model; independent MCP, scope and warmup guards remain', async () => {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<void> | void>();
  const flags: string[] = [], calls: string[][] = [], servers: any[] = [], entries: any[] = [];
  let disabled = false;
  install({
    registerMcpServer(name: string, server: unknown) { servers.push({ name, server }); },
    registerFlag(name: string) { flags.push(name); },
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
