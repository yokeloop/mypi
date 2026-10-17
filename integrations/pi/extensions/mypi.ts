import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startupSections, type StartupWarmup } from '../../../dist/src/shared/startup-context.js';

type Binding = { installation: string; state: string; scope?: string };
const ENTRY = 'mypi-startup-binding';
const MEMORY_SECTION = 'mypi_memory';
const CONTEXT_SECTION = 'mypi_scoped_context';

/** The session branch, not a process-wide selection, owns the active binding. */
function branchBinding(ctx: ExtensionContext): Binding | undefined {
  const entry = ctx.sessionManager.getBranch().filter(item => item.type === 'custom' && item.customType === ENTRY).at(-1);
  if (!entry || entry.type !== 'custom') return undefined;
  const data: unknown = entry.data;
  if (!data || typeof data !== 'object') throw new Error('Invalid mypi session binding');
  const value = data as Record<string, unknown>;
  if (typeof value.installation !== 'string' || typeof value.state !== 'string'
    || (value.scope !== undefined && typeof value.scope !== 'string')) throw new Error('Invalid mypi session binding');
  return value as Binding;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Registers the independent CLI autoload and the existing native MCP server. */
export default function (pi: ExtensionAPI) {
  const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
  const entry = fileURLToPath(new URL('../../../dist/src/mcp/main.js', import.meta.url));
  const cli = fileURLToPath(new URL('../../../dist/src/cli/main.js', import.meta.url));
  if (!existsSync(entry) || !existsSync(cli)) throw new Error('mypi is not built. Run mise exec -- pnpm build in the engine checkout.');
  pi.registerMcpServer('mypi', {
    command: 'node', args: [entry], cwd: root,
    description: 'Local mypi tools for memory, projects, requests and history. No automatic initialization or writes.',
    exposure: 'codemode', toolExposure: { project_resolve: 'direct', warmup: 'direct' },
  });
  pi.registerFlag('mypi-scope', { type: 'string', description: 'Explicit mypi scope (organization or organization/project); omit for automatic cwd/global.' });
  pi.registerFlag('mypi-no-autoload', { type: 'boolean', description: 'Disable mypi CLI context autoload, independently of MCP.' });

  let generation = 0;
  let startup = true;
  pi.on('session_start', () => { generation++; });
  pi.on('session_tree', () => { generation++; });
  pi.on('session_shutdown', () => { generation++; startup = false; });

  async function cliRead(args: string[], ctx: ExtensionContext): Promise<unknown> {
    const result = await pi.exec('node', [cli, ...args], { cwd: root, timeout: 5000, signal: ctx.signal });
    if (result.code !== 0 || result.killed) throw new Error(`mypi ${args[0]} failed: ${result.stderr.trim().slice(0, 500) || 'timeout or nonzero exit'}`);
    return JSON.parse(result.stdout) as unknown;
  }

  pi.on('before_agent_start', async (event, ctx) => {
    // Every model turn uses a fresh ordinary warmup. This also invalidates text after
    // explicit writes/partial outcomes without watching files or caching stale results.
    if (pi.getFlag('mypi-no-autoload')) return;
    const token = ++generation;
    const session = ctx.sessionManager.getSessionId();
    const state = resolve(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'));
    const installation = root;
    const active = () => token === generation && session === ctx.sessionManager.getSessionId();
    let scope: string | undefined;
    try {
      const saved = branchBinding(ctx);
      if (saved && (saved.installation !== installation || saved.state !== state)) {
        throw new Error('Session is bound to another mypi installation or state; context not loaded');
      }
      const flag = pi.getFlag('mypi-scope');
      const explicit = startup && typeof flag === 'string' && flag.length > 0 ? flag : undefined;
      if (saved && explicit && saved.scope !== explicit) throw new Error('Explicit scope conflicts with saved session binding');
      scope = saved?.scope ?? explicit;
      if (!saved && !scope && ctx.cwd !== root) {
        const resolved = await cliRead(['project', 'resolve', ctx.cwd], ctx);
        if (!resolved || typeof resolved !== 'object' || !('match' in resolved)) throw new Error('Invalid project resolution');
        if (resolved.match === 'project' && 'identity' in resolved && typeof resolved.identity === 'string') scope = resolved.identity;
        else if (resolved.match === 'none') throw new Error('Unregistered cwd: choose --mypi-scope explicitly; no context loaded');
        else throw new Error('Ambiguous cwd: choose --mypi-scope explicitly; no context loaded');
      }
      if (!active()) return;
      const response = await cliRead(['warmup', ...(scope === undefined ? [] : ['-s', scope])], ctx);
      if (!active()) return;
      const sections = startupSections(response as StartupWarmup);
      if (!saved) pi.appendEntry<Binding>(ENTRY, { installation, state, ...(scope === undefined ? {} : { scope }) });
      event.systemPromptOptions.sections[MEMORY_SECTION] = `mypi installation: ${installation}; state: ${state}; scope: ${scope ?? 'global'}\n${sections.memory || '(empty)'}`;
      event.systemPromptOptions.sections[CONTEXT_SECTION] = sections.context;
      startup = false;
    } catch (error) {
      if (!active()) return;
      const message = `mypi context unavailable (${errorText(error)}). No previous snapshot was loaded. Use the scoped CLI for full reads.`;
      event.systemPromptOptions.sections[MEMORY_SECTION] = message;
      delete event.systemPromptOptions.sections[CONTEXT_SECTION];
      if (ctx.hasUI) ctx.ui.notify(message, 'warning');
    }
  });
}
