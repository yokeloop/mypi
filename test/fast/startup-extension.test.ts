import test from 'node:test';
import assert from 'node:assert/strict';
import registerStartupExtension, { type ExtensionAPI } from '../../src/app/startup-registration.js';

function install(api: ExtensionAPI): void {
  registerStartupExtension(api);
}

test('native lifecycle no longer mirrors auth/model; MCP registration and opt-out remain; scoped autoload reports it is paused', async () => {
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
  const sections = await turn();
  assert.match(sections.mypi_memory!, /context unavailable \(scoped context autoload is paused/);
  assert.equal(sections.mypi_scoped_context, undefined);
  assert.equal(calls.length, 0, 'no warmup call');
  assert.equal(entries.length, 0, 'no binding without context');
  disabled = true; await emit('session_start'); assert.deepEqual(await turn(), {});
  assert.equal(calls.length, 0);
});
