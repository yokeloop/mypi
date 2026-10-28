import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ExtensionContext {
  hasUI: boolean;
  ui: { notify(message: string, level: 'warning'): void };
  sessionManager: { getSessionId(): string; getSessionName(): string | undefined; getHeader(): { parentSession?: string } | null };
}
interface McpServer {
  command: string; args: string[]; cwd: string; env: Record<string, string>;
  description: string; exposure: string; toolExposure: Record<string, string>;
}
export interface ExtensionAPI {
  registerMcpServer(name: string, server: McpServer): void;
  unregisterMcpServer(name: string): void;
  exec(command: string, args: string[], options: { cwd: string; timeout: number }): Promise<{ code: number; killed?: boolean; stderr: string; stdout: string }>;
  on(name: 'session_start', handler: (event: { reason: string }, ctx: ExtensionContext) => Promise<void>): void;
  on(name: 'session_shutdown', handler: (event: { reason: string }) => Promise<void>): void;
  on(name: 'before_agent_start', handler: (event: { systemPromptOptions: { sections: Record<string, string> } }) => void): void;
}

const SECTION = 'mypi_context';

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
    const key = await register(ctx, session, event.reason === 'startup' && Boolean(ctx.sessionManager.getHeader()?.parentSession));
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
  pi.on('session_shutdown', async event => {
    if (event.reason !== 'quit') return;
    await pi.exec('node', [cli, 'session', 'unregister', '--pid', String(process.pid)], { cwd: root, timeout: 5000 }).catch(() => undefined);
  });
}

export default function mypi(pi: ExtensionAPI): void {
  install(pi, realpathSync(fileURLToPath(new URL('../../', import.meta.url))));
}
