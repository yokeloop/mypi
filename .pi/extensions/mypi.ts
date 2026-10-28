import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ExtensionContext {
  hasUI: boolean;
  ui: { notify(message: string, level: 'warning'): void };
  sessionManager: { getSessionId(): string };
}
interface McpServer {
  command: string; args: string[]; cwd: string; env: Record<string, string>;
  description: string; exposure: string; toolExposure: Record<string, string>;
}
export interface ExtensionAPI {
  registerMcpServer(name: string, server: McpServer): void;
  unregisterMcpServer(name: string): void;
  exec(command: string, args: string[], options: { cwd: string; timeout: number }): Promise<{ code: number; killed?: boolean; stderr: string; stdout: string }>;
  on(name: 'session_start', handler: (event: unknown, ctx: ExtensionContext) => Promise<void>): void;
  on(name: 'before_agent_start', handler: (event: { systemPromptOptions: { sections: Record<string, string> } }) => void): void;
}

const SECTION = 'mypi_context';

export function install(pi: ExtensionAPI, root: string): void {
  const server = join(root, 'dist/src/mcp/main.js');
  const cli = join(root, 'dist/src/cli/main.js');
  if (!existsSync(server) || !existsSync(cli)) throw new Error('mypi is not built. Run mise exec -- pnpm build in the engine checkout.');
  let registered: string | undefined;
  let loaded: string | undefined;
  let context = '';
  pi.on('session_start', async (_event, ctx) => {
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
    if (loaded === session) return;
    context = '';
    let text: string;
    try {
      const result = await pi.exec('node', [cli, 'warmup'], { cwd: root, timeout: 5000 });
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
}

export default function mypi(pi: ExtensionAPI): void {
  install(pi, realpathSync(fileURLToPath(new URL('../../', import.meta.url))));
}
