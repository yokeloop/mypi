import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from '../../.pi/extensions/mypi.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const description = 'Local mypi tools for memory, projects, tasks and history. No automatic initialization or writes.';
const cli = join(root, 'dist/src/cli/main.js');
const reg = (id: string, ...extra: string[]) => ['node', [cli, 'session', 'register', '--agent', 'pi', '--pid', String(process.pid), '--native-id', id, ...extra], { cwd: root, timeout: 5000 }];
const warm = (key: string) => ['node', [cli, 'warmup', '-s', key], { cwd: root, timeout: 5000 }];

function stub() {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<void> | void>();
  const servers: { name: string; config: any }[] = [], removed: string[] = [], calls: unknown[][] = [];
  const notes: [string, string][] = [];
  const registration = () => ({ code: 0, killed: false, stdout: JSON.stringify({ key: state.key, registered: true, displaced: null }) + '\n', stderr: '' });
  const state = { id: 's1', key: 'global', name: undefined as string | undefined, header: null as { parentSession?: string } | null,
    result: (_command: string, args: string[]): unknown => args[1] === 'session' ? registration() : { code: 0, killed: false, stdout: '', stderr: '' } };
  const api = {
    on(name: string, handler: (event: any, ctx: any) => Promise<void> | void) { handlers.set(name, handler); },
    registerMcpServer(name: string, config: unknown) { servers.push({ name, config }); },
    unregisterMcpServer(name: string) { removed.push(name); },
    async exec(command: string, args: string[], options: unknown) { calls.push([command, args, options]); return state.result(command, args); },
  };
  const ctx = { hasUI: true, ui: { notify(message: string, level: string) { notes.push([message, level]); } },
    sessionManager: { getSessionId: () => state.id, getSessionName: () => state.name, getHeader: () => state.header } };
  const start = async (reason: string) => { await handlers.get('session_start')?.({ reason }, ctx); };
  const stop = async (reason: string) => { await handlers.get('session_shutdown')?.({ reason }, ctx); };
  const turn = async () => {
    const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
    await handlers.get('before_agent_start')?.(event, ctx);
    return event.systemPromptOptions.sections;
  };
  return { api: api as never, handlers, servers, removed, calls, notes, state, start, stop, turn, registration };
}

test('pi extension registers mypi MCP with the session id and loads warmup into every turn', async () => {
  const pi = stub();
  install(pi.api, root);
  assert.equal(pi.servers.length, 0);
  assert.deepEqual(pi.calls, []);
  assert.deepEqual([...pi.handlers.keys()].sort(), ['before_agent_start', 'session_shutdown', 'session_start']);
  assert.deepEqual(await pi.turn(), {});
  pi.state.result = (_command, args) => args[1] === 'session' ? pi.registration() : { code: 0, killed: false, stdout: '# mypi warmup: global\n', stderr: '' };
  await pi.start('startup');
  assert.deepEqual(pi.servers, [{ name: 'mypi', config: { command: 'node', args: [join(root, 'dist/src/mcp/main.js')], cwd: root,
    env: { PI_SESSION_ID: 's1' }, description, exposure: 'codemode', toolExposure: { projects: 'direct', warmup: 'direct' } } }]);
  assert.deepEqual(pi.calls, [reg('s1'), warm('global')]);
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

test('pi extension reports a failed warmup in the section and keeps MCP', async () => {
  const pi = stub();
  install(pi.api, root);
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
  install(pi.api, root);
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
  install(pi.api, root);
  const message = '{"status":"error","message":"XDG_RUNTIME_DIR must be an absolute path; the live session registry is kept there"}';
  pi.state.result = (_command, args) => args[1] === 'session' ? { code: 1, killed: false, stdout: '', stderr: message + '\n' }
    : { code: 0, killed: false, stdout: '# mypi warmup: global\n', stderr: '' };
  await pi.start('startup');
  assert.deepEqual(pi.notes[0], ['mypi session registration failed: ' + message + '. This session is not in the mypi registry.', 'warning']);
  assert.deepEqual(pi.calls[1], ['node', [cli, 'warmup'], { cwd: root, timeout: 5000 }]);
  assert.equal((await pi.turn()).mypi_context, '# mypi warmup: global\n');
});

test('pi extension refuses an unbuilt engine', () => {
  const pi = stub();
  assert.throws(() => install(pi.api, join(root, 'missing')), /mypi is not built/);
  assert.deepEqual(pi.servers, []);
  assert.equal(pi.handlers.size, 0);
});
