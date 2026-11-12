import { chmodSync, existsSync, mkdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { registerAsk } from './ask.js';
import type { AskTool } from './ask.js';
import { registerCompact } from './compact.js';
import type { CompactOptions, CompactTool } from './compact.js';
import { completionSource, openCompletions, scopeCodes } from './open-completions.js';
import type { CompletionItem, OpenCatalog } from './open-completions.js';

interface ExtensionContext {
  hasUI: boolean;
  ui: {
    notify(message: string, level: 'info' | 'warning'): void;
    setStatus(key: string, text: string | undefined): void;
    onTerminalInput(handler: (data: string) => { consume?: boolean; data?: string } | undefined): () => void;
  };
  isIdle(): boolean;
  compact(options: CompactOptions): void;
  sessionManager: { getSessionId(): string; getSessionName(): string | undefined; getSessionFile(): string | undefined; getHeader(): { parentSession?: string } | null };
}
interface McpServer {
  command: string; args: string[]; cwd: string; env: Record<string, string>;
  description: string; exposure: string; toolExposure: Record<string, string>;
}
export interface ExtensionAPI {
  registerMcpServer(name: string, server: McpServer): void;
  unregisterMcpServer(name: string): void;
  registerCommand(name: string, command: { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void>;
    getArgumentCompletions?: (prefix: string) => Promise<CompletionItem[] | null> }): void;
  exec(command: string, args: string[], options: { cwd: string; timeout: number }): Promise<{ code: number; killed?: boolean; stderr: string; stdout: string }>;
  sendUserMessage(content: string, options?: { expandPromptTemplates?: boolean; deliverAs?: 'steer' | 'followUp' }): void;
  on(name: 'session_start', handler: (event: { reason: string }, ctx: ExtensionContext) => Promise<void>): void;
  on(name: 'session_shutdown', handler: (event: { reason: string }) => Promise<void>): void;
  on(name: 'agent_start', handler: () => void): void;
  on(name: 'before_agent_start', handler: (event: { systemPromptOptions: { sections: Record<string, string>; toolGuidelines?: Record<string, string[]> } }) => void): void;
  on(name: 'agent_end', handler: (event: { messages: { role: string; content?: unknown }[] }) => void): void;
  on(name: 'agent_settled', handler: (event: unknown, ctx: ExtensionContext) => Promise<void>): void;
  on(name: 'ui_prompt_start', handler: (event: { kind: string; title?: string }) => Promise<void>): void;
  registerTool(tool: AskTool | CompactTool): void;
}

export type RunCli = (args: string[], options: { cwd: string; signal: AbortSignal; onLine: (line: string) => void }) =>
  Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>;

export type ServeEvents = (path: string, onBatch: (events: { id: number; text: string }[]) => Promise<number[]>) => Promise<{ close(): Promise<void> }>;

const SECTION = 'mypi_context';
export const CODEMODE_GUIDELINE = 'In codemode scripts `searchTools()`, `describeTool()` and `describeNamespace()` return Promises, like `tools.*` calls: `await` them before iterating or printing, e.g. `const hits = await searchTools("mcp__mypi open_session")`.';
const MESSAGE_LIMIT = 32000;
const PARENT_MESSAGE = /(?:^|\n)\[mypi: сообщение родительской сессии ([A-Z]+|[a-z0-9]+(?:[._-][a-z0-9]+)*) для [A-Z]+-[1-9][0-9]*\. /;

const unavailable: RunCli = async () => ({ code: null, signal: null, stdout: '', stderr: 'mypi open needs the CLI runner' });

export function isEscape(data: string): boolean {
  return data === '\x1b' || /^\x1b\[27(?:;1(?::1)?)?u$/.test(data) || data === '\x1b[27;1;27~';
}

function clip(text: string): string {
  const cut = text.slice(0, MESSAGE_LIMIT);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

export function install(pi: ExtensionAPI, root: string, serve: ServeEvents, runtime: string | undefined, pid = process.pid,
  runCli: RunCli = unavailable, now: () => number = Date.now): void {
  const server = join(root, 'dist/src/mcp/main.js');
  const cli = join(root, 'dist/src/cli/main.js');
  if (!existsSync(server) || !existsSync(cli)) throw new Error('mypi is not built. Run mise exec -- pnpm build in the engine checkout.');
  registerAsk(pi);
  const compactor = registerCompact(pi, { root, cli, home: join(root, 'home') });
  const register = async (ctx: ExtensionContext, session: string, fork: boolean, socket?: string): Promise<string | undefined> => {
    const name = ctx.sessionManager.getSessionName();
    try {
      const result = await pi.exec('node', [cli, 'session', 'register', '--agent', 'pi', '--pid', String(pid), '--native-id', session,
        ...(name ? ['--name', name] : []), ...(fork ? ['--fork'] : []), ...(socket === undefined ? [] : ['--socket', socket])],
        { cwd: root, timeout: 5000 });
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
  const catalog = completionSource(async () => {
    try {
      const [projects, tasks] = await Promise.all([
        pi.exec('node', [cli, 'project', 'list'], { cwd: root, timeout: 5000 }),
        pi.exec('node', [cli, 'task', 'list'], { cwd: root, timeout: 5000 }),
      ]);
      if (projects.code !== 0 || projects.killed || tasks.code !== 0 || tasks.killed) return undefined;
      return { projects: (JSON.parse(projects.stdout) as { projects: OpenCatalog['projects'] }).projects, tasks: JSON.parse(tasks.stdout) as OpenCatalog['tasks'] };
    } catch { return undefined; }
  }, now);
  let last = '';
  let current: ExtensionContext | undefined;
  let socket: { path: string; server: { close(): Promise<void> }; dev?: number; ino?: number } | undefined;
  let starting: Promise<void> | undefined;
  let started: (() => void) | undefined;
  const injected = new Set<number>();
  let parentTurn = false;
  let parentFrom: string | undefined;
  const onBatch = async (events: { id: number; text: string }[]): Promise<number[]> => {
    const ids = events.map(e => e.id);
    const fresh = events.filter(e => !injected.has(e.id));
    if (fresh.length === 0) return ids;
    await compactor.quiet();
    const text = fresh.map(e => e.text).join('\n\n');
    for (const e of fresh) {
      for (const match of e.text.matchAll(new RegExp(PARENT_MESSAGE.source, 'g'))) {
        parentTurn = true;
        parentFrom = match[1];
      }
    }
    if (starting !== undefined) {
      await starting;
      pi.sendUserMessage(text, { deliverAs: 'followUp' });
    } else if (current?.isIdle()) {
      const turn = starting = new Promise<void>(resolve => { started = resolve; });
      pi.sendUserMessage(text, { deliverAs: 'followUp' });
      await turn;
    } else pi.sendUserMessage(text, { deliverAs: 'followUp' });
    for (const e of fresh) injected.add(e.id);
    return ids;
  };
  pi.on('session_start', async (event, ctx) => {
    const session = ctx.sessionManager.getSessionId();
    if (registered !== session) {
      if (registered !== undefined) pi.unregisterMcpServer('mypi');
      pi.registerMcpServer('mypi', {
        command: 'node', args: [server], cwd: root, env: { PI_SESSION_ID: session },
        description: 'Local mypi tools for projects, tasks, history and knowledge. No automatic initialization or writes.',
        exposure: 'codemode', toolExposure: { projects: 'direct', warmup: 'direct', archive_search: 'direct' },
      });
      registered = session;
    }
    const fork = event.reason === 'startup' && Boolean(ctx.sessionManager.getHeader()?.parentSession);
    key = await register(ctx, session, fork);
    if (loaded !== session) {
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
    }
    if (key === undefined || runtime === undefined) return;
    current = ctx;
    const path = join(runtime, 'mypi', `${key}-${pid}.sock`);
    try {
      mkdirSync(join(runtime, 'mypi'), { recursive: true, mode: 0o700 });
      rmSync(path, { force: true });
      socket = { path, server: await serve(path, onBatch) };
      chmodSync(path, 0o600);
      const { dev, ino } = statSync(path);
      socket.dev = dev;
      socket.ino = ino;
      await register(ctx, session, fork, path);
    } catch (error) {
      if (ctx.hasUI) ctx.ui.notify(`mypi event socket failed: ${error instanceof Error ? error.message : String(error)}`, 'warning');
    }
  });
  pi.on('agent_start', () => {
    const done = started;
    starting = undefined;
    started = undefined;
    done?.();
  });
  pi.on('before_agent_start', event => {
    const options = event.systemPromptOptions;
    if (context) options.sections[SECTION] = context;
    const codemode = (options.toolGuidelines ??= {}).codemode ??= [];
    if (!codemode.includes(CODEMODE_GUIDELINE)) codemode.push(CODEMODE_GUIDELINE);
  });
  pi.on('agent_end', event => {
    const reply = event.messages.filter(message => message.role === 'assistant').at(-1);
    if (reply === undefined) return;
    last = (Array.isArray(reply.content) ? reply.content : [])
      .filter((part): part is { type: 'text'; text: string } => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text).join('\n');
  });
  pi.on('agent_settled', async (_event, ctx) => {
    const report = parentTurn, reply = last, to = parentFrom;
    parentTurn = false;
    parentFrom = undefined;
    last = '';
    if (key !== undefined && report) await pi.exec('node', [cli, 'event', 'emit', '--from', key, ...(to === undefined ? [] : ['--to', to]),
      '--message=' + clip(reply)], { cwd: root, timeout: 5000 })
      .catch(() => undefined);
    const file = ctx.sessionManager.getSessionFile();
    if (file) await pi.exec('node', [cli, 'archive', 'capture', '--agent', 'pi', '--file', file], { cwd: root, timeout: 5000 })
      .catch(() => undefined);
    compactor.settle(ctx);
  });
  pi.on('ui_prompt_start', async event => {
    if (key !== undefined && parentTurn) await pi.exec('node', [cli, 'event', 'emit', '--from', key, ...(parentFrom === undefined ? [] : ['--to', parentFrom]),
      '--waiting', ...(event.title ? ['--message=' + event.title] : [])],
      { cwd: root, timeout: 5000 }).catch(() => undefined);
  });
  pi.on('session_shutdown', async event => {
    compactor.reset();
    const open = socket;
    socket = undefined;
    current = undefined;
    if (open !== undefined) {
      await open.server.close();
      try {
        const stat = statSync(open.path);
        if (stat.dev === open.dev && stat.ino === open.ino) unlinkSync(open.path);
      } catch {}
    }
    if (event.reason !== 'quit') return;
    await pi.exec('node', [cli, 'session', 'unregister', '--pid', String(pid)], { cwd: root, timeout: 5000 }).catch(() => undefined);
  });
  pi.registerCommand('open', {
    description: 'Open or focus mypi sessions in Herdr tabs: /open <key...> [--agent claude|pi] [--permission-mode mode] [--message text]',
    getArgumentCompletions: async prefix => {
      const data = await catalog();
      return data === undefined ? null : openCompletions(prefix, data, scopeCodes(key, data.projects));
    },
    handler: async (args, ctx) => {
      const marker = /(?:^|\s)--message(?:\s|$)/.exec(args);
      const head = marker === null ? args : args.slice(0, marker.index);
      const message = marker === null ? [] : ['--message', args.slice(marker.index + marker[0].length).trim()];
      const controller = new AbortController();
      const stop = ctx.hasUI ? ctx.ui.onTerminalInput(data => {
        if (!isEscape(data)) return undefined;
        controller.abort();
        return { consume: true };
      }) : () => {};
      const status = (text: string | undefined) => { if (ctx.hasUI) ctx.ui.setStatus('mypi-open', text); };
      const words = head.trim().split(/\s+/).filter(Boolean);
      const keys = words.filter((word, i) => !word.startsWith('--') && !['--agent', '--permission-mode'].includes(words[i - 1] ?? ''));
      const label = 'mypi open' + (keys.length > 0 ? ' ' + keys.join(' ') : '') + ': ';
      const progress = (line: string) => {
        const rest = line.slice(6);
        if (!rest.startsWith('cloning ')) return rest;
        const into = rest.indexOf(' into ');
        const cut = into === -1 ? -1 : rest.indexOf(': ', into);
        return cut === -1 ? 'cloning' : rest.slice(cut + 2);
      };
      status(label + 'running — Esc cancels');
      let result;
      try {
        result = await runCli([cli, 'open', ...words, ...message], { cwd: root, signal: controller.signal,
          onLine: line => { if (line.startsWith('mypi: ')) status(label + progress(line) + ' — Esc cancels'); } })
          .catch((error: unknown) => ({ code: null, signal: null, stdout: '', stderr: error instanceof Error ? error.message : String(error) }));
      } finally {
        stop();
        status(undefined);
      }
      if (result.code === 0) {
        ctx.ui.notify('mypi open: ' + result.stdout.trim(), 'info');
        return;
      }
      const text = result.stderr.split('\n').map(line => line.trim()).filter(line => line !== '' && !line.startsWith('mypi: ')).at(-1)?.slice(0, 500)
        || 'timeout or nonzero exit';
      ctx.ui.notify((controller.signal.aborted ? 'mypi open cancelled: ' : 'mypi open failed: ') + text, 'warning');
    },
  });
  pi.registerCommand('inbox', {
    description: 'Show incoming events from task chats: /inbox [org|CODE|all]',
    handler: async args => {
      pi.sendUserMessage(('/skill:inbox ' + args.trim()).trim(), { expandPromptTemplates: true });
    },
  });
  pi.registerCommand('flow', {
    description: 'Run tasks of one project in Pi from the plan to the merge and the release: /flow <name> <KEY> [<KEY>…], or /flow <name> to resume',
    handler: async args => {
      pi.sendUserMessage(('/skill:flow ' + args.trim()).trim(), { expandPromptTemplates: true });
    },
  });
  pi.registerCommand('epic', {
    description: 'Lead an epic in Pi from research to its subtasks: /epic <KEY>',
    handler: async args => {
      pi.sendUserMessage(('/skill:epic ' + args.trim()).trim(), { expandPromptTemplates: true });
    },
  });
}
