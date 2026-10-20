import { existsSync, realpathSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startupSections, type StartupWarmup } from '../shared/startup-context.js';
import { finalEmptySnapshot } from './native-chat-facts.js';

interface ExtensionContext {
  cwd: string;
  signal: AbortSignal;
  hasUI: boolean;
  ui: { notify(message: string, level: 'warning'): void; confirm(title: string, message: string): Promise<boolean>; setStatus?(key: string, text: string): void };
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

/** Keep the preview's JSON bytes together; the shared CLI still validates its contents. */
function slashWorkChatArgs(input: string): string[] {
  const text = input.trim();
  const execute = /^execute\s+(--focus\s+)?--preview(?:\s+|=)([\s\S]*)$/.exec(text);
  if (!execute) return text.split(/\s+/);
  const body = execute[2]!;
  let end = body.length;
  if (body.startsWith('{') || body.startsWith('[')) {
    let depth = 0, quoted = false, escaped = false;
    for (let i = 0; i < body.length; i++) {
      const char = body[i];
      if (escaped) { escaped = false; continue; }
      if (quoted && char === '\\') { escaped = true; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      if (char === '{' || char === '[') depth++;
      if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
  }
  const suffix = body.slice(end), remainder = suffix.trim();
  const before = execute[1] ? ['--focus'] : [];
  // Only one whitespace-separated trailing focus flag is meaningful; other tails
  // remain one invalid CLI argument rather than becoming a replacement preview.
  const after = remainder ? [/^\s+--focus$/.test(suffix) && !execute[1] ? '--focus'
    : remainder === '--focus' ? '--focus --focus' : remainder] : [];
  return ['execute', ...before, '--preview', body.slice(0, end), ...after];
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
      if (args.trim() === 'adopt-model') { await adoptModel(ctx); return; }
      if (!args.trim() || args.trim() === 'help') {
        ctx.ui.notify('work-chat open --project org/project --request-id N --source-clone /clone --worktree /worktree [--model provider/model-id]; resume ID; new-empty ID; list; show ID; execute --preview JSON [--focus]; adopt-model. Preview first; never sends a prompt. See mypi --help.', 'warning');
        return;
      }
      // CLI remains the validator and application dispatch; no shell evaluates arguments.
      // Only execute --preview needs one intact JSON argv item from the slash input.
      const result = await pi.exec('node', [cli, 'work-chat', ...slashWorkChatArgs(args)],
        { cwd: root, timeout: 30000, signal: ctx.signal });
      ctx.ui.notify((result.code === 0 ? result.stdout : result.stderr).slice(0, 4000) || 'work-chat command failed', 'warning');
    },
  });
  async function adoptModel(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    const attempt = pi.getFlag('mypi-chat-attempt');
    const session = ctx.sessionManager.getSessionId();
    let issued = chatGeneration;
    const current = () => issued === chatGeneration && pi.getFlag('mypi-chat-attempt') === attempt
      && ctx.sessionManager.getSessionId() === session;
    try {
      const previewReport = report(ctx, 'adopt:preview');
      issued = chatGeneration;
      const before = await previewReport;
      if (!current()) return;
      if (!before) throw new Error('Native model is not locally authorized');
      const preview = await syncSelection(ctx, before, false);
      if (!current()) return;
      if (preview.status === 'ready') {
        ctx.ui.setStatus?.('mypi-work-chat', 'work chat ready');
        ctx.ui.notify('Work chat already ready for this selection; no different model to adopt.', 'warning');
        return;
      }
      if (preview.status !== 'mismatch') throw new Error('Native selection unconfirmed');
      const expected = `${preview.expected.provider}/${preview.expected.model}`;
      const selected = `${preview.selected.provider}/${preview.selected.model}`;
      if (!await ctx.ui.confirm('Adopt selected work-chat model?', `Expected ${expected}; selected ${selected}. Change this chat target to ${selected}?`)) {
        if (current()) ctx.ui.notify('Model adoption cancelled; expected target remains pending.', 'warning');
        return;
      }
      if (!current()) return;
      const confirmReport = report(ctx, 'adopt:confirm');
      issued = chatGeneration;
      const after = await confirmReport;
      if (!current()) return;
      if (!after || after.attempt !== before.attempt || after.sessionId !== before.sessionId
        || after.processId !== before.processId || after.model.provider !== before.model.provider
        || after.model.model !== before.model.model) throw new Error('Native model/session changed while confirming');
      const adopted = await syncSelection(ctx, after, true, preview.expected);
      if (!current()) return;
      if (adopted.status !== 'ready') throw new Error('Native model or target changed; adoption refused');
      ctx.ui.setStatus?.('mypi-work-chat', 'work chat ready');
      ctx.ui.notify(`Work chat ready: adopted ${selected} in this tab. No prompt was sent.`, 'warning');
    } catch {
      if (!current()) return;
      ctx.ui.setStatus?.('mypi-work-chat', 'work chat unknown');
      ctx.ui.notify('Model adoption unconfirmed; target and pending reservation preserved. Inspect /work-chat show.', 'warning');
      if (typeof attempt === 'string' && /^[0-9a-f-]{36}$/.test(attempt)) {
        afterLaunchCommit(attempt, current, async () => { await eventReport(ctx, 'adopt:post-commit', false, false); });
      }
    }
  }
  pi.registerFlag('mypi-scope', { type: 'string', description: 'Explicit mypi scope (organization or organization/project); omit for automatic cwd/global.' });
  pi.registerFlag('mypi-no-autoload', { type: 'boolean', description: 'Disable mypi CLI context autoload, independently of MCP.' });
  pi.registerFlag('mypi-chat-attempt', { type: 'string', description: 'Internal work-chat launch attempt.' });
  pi.registerFlag('mypi-chat-model', { type: 'string', description: 'Internal exact work-chat model pair.' });
  pi.registerFlag('mypi-chat-unpinned', { type: 'boolean', description: 'Internal model-unpinned launch while target authorization is missing.' });
  pi.registerFlag('mypi-chat-override', { type: 'boolean', description: 'Persist explicit work-chat resume model.' });

  // Pi applies CLI flag values after extension factories run. Register the lifecycle
  // bridge now, but read managed flags only from events after session initialization.
  // Node performs all SQLite and filesystem association work outside Pi's Bun process.
  const ack = fileURLToPath(new URL('../../../dist/src/app/work-chat-ack.js', import.meta.url));
  const state = resolve(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'));
  let chatGeneration = 0;
  let pendingHandoff: ReturnType<typeof watch> | undefined;
  let starting = true;
  type SelectionReceipt = { attempt: string; sessionId: string; processId: number; generation: number; model: { provider: string; model: string } };
  async function syncSelection(ctx: ExtensionContext, receipt: SelectionReceipt, adopt: boolean,
    expectedTarget?: { provider: string; model: string }): Promise<{ status: string; expected: { provider: string; model: string }; selected: { provider: string; model: string } }> {
    const data = expectedTarget ? { ...receipt, expectedTarget } : receipt;
    const result = await pi.exec('node', [cli, 'work-chat', 'sync-attempt', '--receipt', JSON.stringify(data), ...(adopt ? ['--adopt'] : [])],
      { cwd: root, timeout: 12000, signal: ctx.signal });
    if (result.code !== 0 || result.killed) throw new Error('Native work chat sync unavailable');
    return JSON.parse(result.stdout) as { status: string; expected: { provider: string; model: string }; selected: { provider: string; model: string } };
  }
  function afterLaunchCommit(attempt: string, current: () => boolean, retry: () => Promise<void>) {
    const dir = join(state, 'mypi', 'work-chat-acks');
    const marker = attempt + '-committed';
    let observer: ReturnType<typeof watch> | undefined;
    let delivered = false;
    const close = () => {
      observer?.close();
      if (pendingHandoff === observer) pendingHandoff = undefined;
    };
    const deliver = () => {
      if (delivered) return;
      delivered = true;
      close();
      if (current()) void retry();
    };
    try {
      // Watch before checking existence: the commit cannot be lost between
      // a read and subscription. At most one unref'd watcher lives per Pi
      // session; it ends at commit, a newer native event, or session exit.
      observer = watch(dir, (_event, filename) => {
        if (filename === marker || filename === null && existsSync(join(dir, marker))) deliver();
      });
      pendingHandoff = observer;
      observer.unref?.();
      observer.on('error', close);
      if (existsSync(join(dir, marker))) deliver();
    } catch { close(); }
  }
  async function report(ctx: ExtensionContext, lifecycle: string, persist = false): Promise<SelectionReceipt | undefined> {
    const attempt = pi.getFlag('mypi-chat-attempt');
    if (typeof attempt !== 'string' || !/^[0-9a-f-]{36}$/.test(attempt)) return;
    const token = ++chatGeneration;
    pendingHandoff?.close(); pendingHandoff = undefined;
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
    if (!target && pi.getFlag('mypi-chat-model') !== 'null') error = 'Invalid native work-chat target model';
    const current = ctx.model;
    const selected = current && ctx.modelRegistry.find(current.provider, current.id);
    const authReady = Boolean(selected && selected.provider === current?.provider && selected.id === current.id
      && ctx.modelRegistry.hasConfiguredAuth(selected));
    // Pi 1.0.4 reports unknown/unknown, rather than undefined, if no model is
    // available before login. Admit that sentinel only for an explicitly unpinned
    // launch; never acknowledge it as a selected provider/model.
    const placeholder = pi.getFlag('mypi-chat-unpinned') === true && current?.provider === 'unknown'
      && current.id === 'unknown' && !selected;
    if (current && !placeholder && (!selected || selected.provider !== current.provider || selected.id !== current.id)) {
      error = 'Native current model absent from registry';
    }
    if (lifecycle === 'start:startup' && authReady && !pi.getFlag('mypi-chat-unpinned')
      && (!target || target.provider !== current?.provider || target.model !== current.id)) {
      error = 'Native startup selected another model';
    }
    if (persist && target && !error && authReady
      && selected?.provider === target.provider && selected.id === target.model) {
      // An unpinned pending resume may restore another authenticated model.
      // Do not persist or reject that selection as an override of the requested target.
      if (!await pi.setModel(selected)) error = 'Exact native model override cannot be persisted';
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
      scope: pi.getFlag('mypi-scope'), authReady,
      model: current && !placeholder ? { provider: current.provider, model: current.id } : undefined,
      fileExists: Boolean(ctx.sessionManager.getSessionFile() && existsSync(ctx.sessionManager.getSessionFile()!)) };
    const result = await pi.exec('node', [ack, state, attempt, JSON.stringify(data)], { cwd: root, timeout: 5000, signal: ctx.signal });
    if (result.code !== 0 || result.killed) {
      if (ctx.hasUI) ctx.ui.notify('Work chat acknowledgement unavailable; reservation remains pending/unknown.', 'warning');
      return;
    }
    if (lifecycle.startsWith('start:')) starting = false;
    if (!error && authReady && current && !placeholder) return { attempt, sessionId: data.sessionId, processId: process.pid,
      generation: token, model: { provider: current.provider, model: current.id } };
    return;
  }
  const chatReport = (ctx: ExtensionContext) => eventReport(ctx, 'before_agent_start');
  async function eventReport(ctx: ExtensionContext, lifecycle: string, persist = false, allowHandoff = true) {
    const attempt = pi.getFlag('mypi-chat-attempt');
    const session = ctx.sessionManager.getSessionId();
    const reporting = report(ctx, lifecycle, persist);
    const issued = chatGeneration; // report increments synchronously before its first await.
    const receipt = await reporting;
    if (!ctx.hasUI || typeof attempt !== 'string' || chatGeneration !== issued
      || pi.getFlag('mypi-chat-attempt') !== attempt || ctx.sessionManager.getSessionId() !== session) return;
    if (!receipt) {
      ctx.ui.setStatus?.('mypi-work-chat', 'work chat pending/unknown');
      ctx.ui.notify('Work chat pending/unknown: select a locally authorized model with /login or /model, then inspect /work-chat show. No prompt was sent.', 'warning');
      return;
    }
    // A previous async sync must never repaint the tab ready after a newer
    // model_select, credential loss or session switch.
    const current = () => chatGeneration === receipt.generation
      && pi.getFlag('mypi-chat-attempt') === receipt.attempt
      && ctx.sessionManager.getSessionId() === receipt.sessionId;
    // One guarded reconciliation after the acknowledgement, not an event-loop poll.
    // The launcher's DB reservation may still be settling during session_start.
    const apply = (result: Awaited<ReturnType<typeof syncSelection>>) => {
      if (!current()) return;
      if (result.status === 'mismatch') ctx.ui.notify(`Work chat pending: expected ${result.expected.provider}/${result.expected.model}; selected ${result.selected.provider}/${result.selected.model}. Use /model for the expected target or /work-chat adopt-model to confirm this selection.`, 'warning');
      else if (result.status === 'ready') ctx.ui.notify(`Work chat ready: ${receipt.model.provider}/${receipt.model.model}. No prompt was sent.`, 'warning');
      else throw new Error('Unconfirmed sync result');
      ctx.ui.setStatus?.('mypi-work-chat', result.status === 'ready' ? 'work chat ready' : 'work chat pending');
    };
    const reconcile = async () => {
      try { apply(await syncSelection(ctx, receipt, false)); }
      catch {
        if (!current()) return;
        ctx.ui.setStatus?.('mypi-work-chat', 'work chat unknown');
        ctx.ui.notify('Work chat readiness unconfirmed; waiting for launch commit or inspect /work-chat show.', 'warning');
        // The one-shot marker is emitted only after the launcher's SQL commit.
        // No polling, session restart or prompt replay; the same receipt is
        // independently verified once more, and never overrides newer events.
        if (allowHandoff) afterLaunchCommit(receipt.attempt, current, async () => {
          try { apply(await syncSelection(ctx, receipt, false)); }
          catch { /* The original unknown notice remains truthful; never re-arm. */ }
        });
      }
    };
    void reconcile();
  }
  pi.on('session_start', (event, ctx) => eventReport(ctx, 'start:' + (event as { reason?: string }).reason,
    Boolean(pi.getFlag('mypi-chat-override')) && (event as { reason?: string }).reason === 'startup'));
  pi.on('session_tree', (_event, ctx) => eventReport(ctx, 'tree'));
  pi.on('model_select', (_event, ctx) => starting ? undefined : eventReport(ctx, 'model_select'));
  pi.on('session_shutdown', async (event, ctx) => { await report(ctx, 'shutdown:' + (event as { reason?: string }).reason); });

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
