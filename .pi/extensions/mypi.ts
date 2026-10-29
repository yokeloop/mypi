import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ExtensionContext {
  hasUI: boolean;
  ui: { notify(message: string, level: 'info' | 'warning'): void };
  sessionManager: { getSessionId(): string; getSessionName(): string | undefined; getHeader(): { parentSession?: string } | null };
}
interface McpServer {
  command: string; args: string[]; cwd: string; env: Record<string, string>;
  description: string; exposure: string; toolExposure: Record<string, string>;
}
export interface ExtensionAPI {
  registerMcpServer(name: string, server: McpServer): void;
  unregisterMcpServer(name: string): void;
  registerCommand(name: string, command: { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }): void;
  exec(command: string, args: string[], options: { cwd: string; timeout: number }): Promise<{ code: number; killed?: boolean; stderr: string; stdout: string }>;
  on(name: 'session_start', handler: (event: { reason: string }, ctx: ExtensionContext) => Promise<void>): void;
  on(name: 'session_shutdown', handler: (event: { reason: string }) => Promise<void>): void;
  on(name: 'before_agent_start', handler: (event: { systemPromptOptions: { sections: Record<string, string> } }) => void): void;
  on(name: 'agent_end', handler: (event: { messages: { role: string; content?: unknown }[] }) => void): void;
  on(name: 'agent_settled', handler: () => Promise<void>): void;
  on(name: 'ui_prompt_start', handler: (event: { kind: string; title?: string }) => Promise<void>): void;
}

const SECTION = 'mypi_context';
const MESSAGE_LIMIT = 32000;

function clip(text: string): string {
  const cut = text.slice(0, MESSAGE_LIMIT);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

export function install(pi: ExtensionAPI, root: string): void {
  const server = join(root, 'dist/src/mcp/main.js');
  const cli = join(root, 'dist/src/cli/main.js');
  if (!existsSync(server) || !existsSync(cli)) throw new Error('mypi is not built. Run mise exec -- pnpm build in the engine checkout.');
  const register = async (ctx: ExtensionContext, session: string, fork: boolean): Promise<string | undefined> => {
    const name = ctx.sessionManager.getSessionName();
    try {
      const result = await pi.exec('node', [cli, 'session', 'register', '--agent', 'pi', '--pid', String(process.pid), '--native-id', session,
        ...(name ? ['--name', name] : []), ...(fork ? ['--fork'] : [])], { cwd: root, timeout: 5000 });
      if (result.code !== 0 || result.killed) throw new Error(result.stderr.trim().slice(0, 500) || 'timeout or nonzero exit');
      return (JSON.parse(result.stdout) as { key: string }).key;
    } catch (error) {
      if (ctx.hasUI) ctx.ui.notify(`mypi session registration failed: ${error instanceof Error ? error.message : String(error)}. This session is not in the mypi registry.`, 'warning');
      return undefined;
    }
  };
  let registered: string | undefined;
  let loaded: string | undefined;
  let context = '';
  let key: string | undefined;
  let last = '';
  pi.on('session_start', async (event, ctx) => {
    const session = ctx.sessionManager.getSessionId();
    if (registered !== session) {
      if (registered !== undefined) pi.unregisterMcpServer('mypi');
      pi.registerMcpServer('mypi', {
        command: 'node', args: [server], cwd: root, env: { PI_SESSION_ID: session },
        description: 'Local mypi tools for memory, projects, tasks and history. No automatic initialization or writes.',
        exposure: 'codemode', toolExposure: { projects: 'direct', warmup: 'direct' },
      });
      registered = session;
    }
    key = await register(ctx, session, event.reason === 'startup' && Boolean(ctx.sessionManager.getHeader()?.parentSession));
    if (loaded === session) return;
    context = '';
    let text: string;
    try {
      const result = await pi.exec('node', [cli, 'warmup', ...(key === undefined ? [] : ['-s', key])], { cwd: root, timeout: 5000 });
      if (result.code !== 0 || result.killed) throw new Error(result.stderr.trim().slice(0, 500) || 'timeout or nonzero exit');
      text = result.stdout;
    } catch (error) {
      text = `mypi warmup failed: ${error instanceof Error ? error.message : String(error)}. No mypi context was loaded; call the mypi warmup tool to read it.`;
      if (ctx.hasUI) ctx.ui.notify(text, 'warning');
    }
    if (ctx.sessionManager.getSessionId() !== session) return;
    loaded = session;
    context = text;
  });
  pi.on('before_agent_start', event => {
    if (context) event.systemPromptOptions.sections[SECTION] = context;
  });
  pi.on('agent_end', event => {
    const reply = event.messages.filter(message => message.role === 'assistant').at(-1);
    if (reply === undefined) return;
    last = (Array.isArray(reply.content) ? reply.content : [])
      .filter((part): part is { type: 'text'; text: string } => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text).join('\n');
  });
  pi.on('agent_settled', async () => {
    if (key !== undefined) await pi.exec('node', [cli, 'event', 'emit', '--from', key, '--message=' + clip(last)], { cwd: root, timeout: 5000 })
      .catch(() => undefined);
    last = '';
  });
  pi.on('ui_prompt_start', async event => {
    if (key !== undefined) await pi.exec('node', [cli, 'event', 'emit', '--from', key, '--waiting', ...(event.title ? ['--message=' + event.title] : [])],
      { cwd: root, timeout: 5000 }).catch(() => undefined);
  });
  pi.on('session_shutdown', async event => {
    if (event.reason !== 'quit') return;
    await pi.exec('node', [cli, 'session', 'unregister', '--pid', String(process.pid)], { cwd: root, timeout: 5000 }).catch(() => undefined);
  });
  pi.registerCommand('open', {
    description: 'Open or focus mypi sessions in Herdr tabs: /open <key...> [--agent claude|pi] [--permission-mode mode]',
    handler: async (args, ctx) => {
      const result = await pi.exec('node', [cli, 'open', ...args.trim().split(/\s+/).filter(Boolean)], { cwd: root, timeout: 120000 })
        .catch((error: unknown) => ({ code: 1, killed: false, stdout: '', stderr: error instanceof Error ? error.message : String(error) }));
      if (result.code === 0 && !result.killed) ctx.ui.notify('mypi open: ' + result.stdout.trim(), 'info');
      else ctx.ui.notify('mypi open failed: ' + (result.stderr.trim().slice(0, 500) || 'timeout or nonzero exit'), 'warning');
    },
  });
}

export default function mypi(pi: ExtensionAPI): void {
  install(pi, realpathSync(fileURLToPath(new URL('../../', import.meta.url))));
}
