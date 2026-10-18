import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startupSections, type StartupWarmup } from '../shared/startup-context.js';
import { finalEmptySnapshot } from './native-chat-facts.js';

interface ExtensionContext {
  cwd: string;
  signal: AbortSignal;
  hasUI: boolean;
  ui: { notify(message: string, level: 'warning'): void };
  model?: { provider: string; id: string };
  modelRegistry: { find(provider: string, model: string): { provider: string; id: string } | undefined; hasConfiguredAuth(model: { provider: string; id: string }): boolean };
  sessionManager: { getSessionId(): string; getSessionFile(): string | undefined;
    getHeader(): { id: string; cwd: string } | null;
    getEntries(): Array<{ type: string; message?: { role?: string } }>;
    getBranch(): Array<{ type: string; customType?: string; data?: unknown; provider?: string; modelId?: string }> };
}
interface ExtensionAPI {
  registerMcpServer(name: string, server: { command: string; args: string[]; cwd: string; description: string; exposure: string; toolExposure: Record<string, string> }): void;
  registerFlag(name: string, flag: { type: 'boolean' | 'string'; description: string }): void;
  registerCommand(name: string, command: { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }): void;
  getFlag(name: string): unknown;
  appendEntry<T>(name: string, value: T): void;
  setModel(model: { provider: string; id: string }): Promise<boolean>;
  exec(command: string, args: string[], options: { cwd: string; timeout: number; signal: AbortSignal }): Promise<{ code: number; killed?: boolean; stderr: string; stdout: string }>;
  on(name: string, handler: (event: StartupEvent, ctx: ExtensionContext) => void | Promise<void>): void;
}
interface StartupEvent {
  toolName: string;
  input: Record<string, unknown>;
  args: Record<string, unknown>;
  command: string;
  systemPromptOptions: { sections: Record<string, string> };
}
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
  pi.registerCommand('work-chat', { description: 'Preview, inspect or explicitly execute independent task work chats (see /work-chat help)',
    async handler(args, ctx) {
      if (!args.trim() || args.trim() === 'help') {
        ctx.ui.notify('work-chat open --project org/project --request-id N --source-clone /clone --worktree /worktree [--model provider/model-id]; resume ID; new-empty ID; list; show ID; execute --preview JSON [--focus]. Preview first; never sends a prompt. See mypi --help.', 'warning');
        return;
      }
      // CLI remains the sole argument parser and application dispatch. Slash arguments are
      // whitespace-delimited: use CLI/MCP for values containing whitespace.
      const result = await pi.exec('node', [cli, 'work-chat', ...args.trim().split(/\s+/)],
        { cwd: root, timeout: 30000, signal: ctx.signal });
      ctx.ui.notify((result.code === 0 ? result.stdout : result.stderr).slice(0, 4000) || 'work-chat command failed', 'warning');
    },
  });
  pi.registerFlag('mypi-scope', { type: 'string', description: 'Explicit mypi scope (organization or organization/project); omit for automatic cwd/global.' });
  pi.registerFlag('mypi-no-autoload', { type: 'boolean', description: 'Disable mypi CLI context autoload, independently of MCP.' });
  pi.registerFlag('mypi-chat-attempt', { type: 'string', description: 'Internal work-chat launch attempt.' });
  pi.registerFlag('mypi-chat-model', { type: 'string', description: 'Internal exact work-chat model pair.' });
  pi.registerFlag('mypi-chat-override', { type: 'boolean', description: 'Persist explicit work-chat resume model.' });

  // Pi applies CLI flag values after extension factories run. Register the lifecycle
  // bridge now, but read managed flags only from events after session initialization.
  // Node performs all SQLite and filesystem association work outside Pi's Bun process.
  const ack = fileURLToPath(new URL('../../../dist/src/app/work-chat-ack.js', import.meta.url));
  const state = resolve(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'));
  let chatGeneration = 0;
  let starting = true;
  async function report(ctx: ExtensionContext, lifecycle: string, persist = false): Promise<void> {
    const attempt = pi.getFlag('mypi-chat-attempt');
    if (typeof attempt !== 'string' || !/^[0-9a-f-]{36}$/.test(attempt)) return;
    const token = ++chatGeneration;
    let error: string | undefined;
    let target: { provider: string; model: string } | undefined;
    try {
      const pair = pi.getFlag('mypi-chat-model');
      const parsed: unknown = typeof pair === 'string' ? JSON.parse(pair) : undefined;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const value = parsed as Record<string, unknown>;
        if (typeof value.provider === 'string' && value.provider && typeof value.model === 'string' && value.model) {
          target = { provider: value.provider, model: value.model };
        }
      }
    } catch { /* Report the invalid target through the native acknowledgement. */ }
    if (!target) error = 'Invalid native work-chat target model';
    const current = ctx.model;
    const selected = current && ctx.modelRegistry.find(current.provider, current.id);
    if (!selected || selected.provider !== current?.provider || selected.id !== current.id
      || !ctx.modelRegistry.hasConfiguredAuth(selected)) error = 'Native registry/auth/current model mismatch';
    if (lifecycle === 'start:startup' && (!target || target.provider !== current?.provider || target.model !== current.id)) {
      error = 'Native startup selected another model';
    }
    if (persist && target && !error) {
      if (!await pi.setModel(selected!)) error = 'Exact native model override cannot be persisted';
      const branch = ctx.sessionManager.getBranch().filter(item => item.type === 'model_change').at(-1);
      if (!branch || branch.provider !== target.provider || branch.modelId !== target.model) error = 'Native active branch did not persist override';
    }
    if (token !== chatGeneration) return;
    const entries = lifecycle === 'shutdown:quit' ? ctx.sessionManager.getEntries() : [];
    const finalEmpty = lifecycle === 'shutdown:quit' && finalEmptySnapshot(ctx.sessionManager.getHeader(), entries,
      ctx.sessionManager.getSessionId(), ctx.cwd);
    let savedBinding: Binding | undefined;
    try { savedBinding = branchBinding(ctx); }
    catch { error = 'Invalid native active-branch binding'; }
    const selectedBranch = ctx.sessionManager.getBranch().filter(entry => entry.type === 'model_change').at(-1);
    const data = { attempt, lifecycle, generation: token, error, finalEmpty,
      branchBinding: savedBinding, branchModel: selectedBranch && { provider: selectedBranch.provider, model: selectedBranch.modelId },
      sessionId: ctx.sessionManager.getSessionId(), historyPath: ctx.sessionManager.getSessionFile(),
      cwd: ctx.cwd, processCwd: process.cwd(), processId: process.pid, installation: root, state,
      scope: pi.getFlag('mypi-scope'), model: ctx.model && { provider: ctx.model.provider, model: ctx.model.id },
      fileExists: Boolean(ctx.sessionManager.getSessionFile() && existsSync(ctx.sessionManager.getSessionFile()!)) };
    const result = await pi.exec('node', [ack, state, attempt, JSON.stringify(data)], { cwd: root, timeout: 5000, signal: ctx.signal });
    if (result.code !== 0 || result.killed) ctx.ui.notify('Work chat acknowledgement unavailable: ' + result.stderr.slice(0, 200), 'warning');
    if (lifecycle.startsWith('start:')) starting = false;
  }
  const chatReport = (ctx: ExtensionContext) => report(ctx, 'before_agent_start');
  pi.on('session_start', (event, ctx) => report(ctx, 'start:' + (event as { reason?: string }).reason,
    Boolean(pi.getFlag('mypi-chat-override')) && (event as { reason?: string }).reason === 'startup'));
  pi.on('session_tree', (_event, ctx) => report(ctx, 'tree'));
  pi.on('model_select', (_event, ctx) => starting ? undefined : report(ctx, 'model_select'));
  pi.on('session_shutdown', (event, ctx) => report(ctx, 'shutdown:' + (event as { reason?: string }).reason));

  let generation = 0;
  let startup = true;
  let snapshot: { memory: string; context: string } | undefined;
  const invalidate = () => { generation++; snapshot = undefined; };
  pi.on('session_start', () => { invalidate(); startup = true; });
  pi.on('session_tree', invalidate);
  pi.on('session_shutdown', () => { invalidate(); startup = false; });
  // An explicit memory read may reveal an external edit; a write (including a partial
  // failure) may have changed the file. Invalidate before and after the tool so an
  // earlier asynchronous warmup cannot install a stale snapshot.
  const memoryTool = (name: string, input: Record<string, unknown>) =>
    /(?:^|[_:])memory_(?:show|add|remove)$/.test(name)
    || ((name === 'bash' || name === 'powershell') && typeof input.command === 'string'
      && /\bmypi\s+memory\s+(?:show|add|remove)\b/.test(input.command));
  pi.on('tool_call', event => { if (memoryTool(event.toolName, event.input)) invalidate(); });
  pi.on('tool_result', event => { if (memoryTool(event.toolName, event.input)) invalidate(); });
  // Codemode invokes MCP tools as nested calls: its outer tool result does not name
  // the memory operation. Nested execution events expose the actual MCP tool name.
  pi.on('tool_execution_start', event => { if (memoryTool(event.toolName, event.input ?? event.args ?? {})) invalidate(); });
  pi.on('tool_execution_end', event => { if (memoryTool(event.toolName, {})) invalidate(); });
  pi.on('user_bash', event => { if (memoryTool('bash', { command: event.command })) invalidate(); });

  async function cliRead(args: string[], ctx: ExtensionContext): Promise<unknown> {
    const result = await pi.exec('node', [cli, ...args], { cwd: root, timeout: 5000, signal: ctx.signal });
    if (result.code !== 0 || result.killed) throw new Error(`mypi ${args[0]} failed: ${result.stderr.trim().slice(0, 500) || 'timeout or nonzero exit'}`);
    return JSON.parse(result.stdout) as unknown;
  }

  pi.on('before_agent_start', async (event, ctx) => {
    // Reuse the session-local snapshot on ordinary turns and after compaction.
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
      const cwd = realpathSync(ctx.cwd);
      if (!saved && !scope && cwd !== root) {
        const resolved = await cliRead(['project', 'resolve', cwd], ctx);
        if (!resolved || typeof resolved !== 'object' || !('match' in resolved)) throw new Error('Invalid project resolution');
        if (resolved.match === 'project' && 'identity' in resolved && typeof resolved.identity === 'string') scope = resolved.identity;
        else if (resolved.match === 'none') throw new Error('Unregistered cwd: choose --mypi-scope explicitly; no context loaded');
        else throw new Error('Ambiguous cwd: choose --mypi-scope explicitly; no context loaded');
      }
      if (!active()) return;
      if (!snapshot) {
        // An explicit global selection is not an organization named "global".
        const response = await cliRead(['warmup', ...(scope === undefined || scope === 'global' ? [] : ['-s', scope])], ctx);
        if (!active()) return;
        snapshot = startupSections(response as StartupWarmup);
      }
      if (!saved) pi.appendEntry<Binding>(ENTRY, { installation, state, ...(scope === undefined ? {} : { scope }) });
      event.systemPromptOptions.sections[MEMORY_SECTION] = `mypi installation: ${installation}; state: ${state}; scope: ${scope ?? 'global'}\n${snapshot.memory || '(empty)'}`;
      event.systemPromptOptions.sections[CONTEXT_SECTION] = snapshot.context;
      startup = false;
      if (chatReport) {
        try { await chatReport(ctx); }
        catch (error) { if (ctx.hasUI) ctx.ui.notify('Work chat acknowledgement unavailable: ' + errorText(error), 'warning'); }
      }
    } catch (error) {
      if (!active()) return;
      const message = `mypi context unavailable (${errorText(error)}). No previous snapshot was loaded. Use the scoped CLI for full reads.`;
      event.systemPromptOptions.sections[MEMORY_SECTION] = message;
      delete event.systemPromptOptions.sections[CONTEXT_SECTION];
      if (ctx.hasUI) ctx.ui.notify(message, 'warning');
    }
  });
}
