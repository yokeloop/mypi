import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InputError } from '../shared/errors.js';
import type { ChatRuntime, ChatInspection } from './work-chats.js';
import { exactCatalogModel, readyAuth, nativeHistory, startupReceipt } from './native-chat-facts.js';
import type { ChatBinding, ModelPair, NativeIdentity, WorkChat } from '../modules/work-chats/public.js';

function command(binary: string, args: string[], cwd: string, env = process.env): string {
  const result = spawnSync(binary, args, { cwd, env, encoding: 'utf8', timeout: 7000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0 || result.signal || result.stderr.trim()) throw new InputError(`${basename(binary)} ${args[0]} unavailable: ${args[0] === '--offline' ? 'model catalog could not be read' : (result.stderr || result.error?.message || 'nonzero exit').slice(0, 300)}`);
  return result.stdout;
}
function git(cwd: string, ...args: string[]): string { return command('git', args, cwd).trim(); }
function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return !!path && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}
function json(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InputError('Malformed native observation');
  return parsed as Record<string, unknown>;
}
function processStart(pid: number, readStat: (path: string, encoding: 'utf8') => string = readFileSync): string {
  const text = readStat(`/proc/${pid}/stat`, 'utf8');
  const close = text.lastIndexOf(')');
  if (close < 0 || text[close + 1] !== ' ') throw new InputError('Malformed procfs process stat');
  const tail = text.slice(close + 2).trim().split(/\s+/);
  if (!/^\d+$/.test(tail[19] ?? '')) throw new InputError('Malformed procfs process start');
  return tail[19]!; // Linux stat field 22 (tail begins with field 3).
}

/** Only a verified missing procfs entry permits release; reuse and unreadable entries do not. */
export function inspectAbsentPaneProcess(pid: number, readStat?: (path: string, encoding: 'utf8') => string): ChatInspection {
  try {
    processStart(pid, readStat);
    return { status: 'unknown', reason: 'Pane occupant changed while process remains' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try {
        processStart(process.pid, readStat);
        return { status: 'dead' };
      } catch (selfError) { return { status: 'unknown', reason: 'Procfs availability unconfirmed: ' + String(selfError) }; }
    }
    return { status: 'unknown', reason: 'Process absence unconfirmed: ' + String(error) };
  }
}
interface Ack { attempt: string; lifecycle: string; generation: number; sessionId: string; historyPath: string; cwd: string; processCwd: string; processId: number; installation: string; state: string; scope: string; model?: ModelPair; authReady?: boolean; fileExists: boolean; provenEmpty?: boolean; everPersisted?: boolean; continuous?: boolean; branchBinding?: { installation: string; state: string; scope?: string }; branchModel?: ModelPair; error?: string }
function ack(chat: WorkChat, startup = false): Ack | undefined {
  const filename = join(chat.statePath, 'mypi', 'work-chat-acks', chat.attemptId + (startup ? '-start' : '') + '.json');
  if (!existsSync(filename)) return undefined;
  return json(readFileSync(filename, 'utf8')) as unknown as Ack;
}
function identity(chat: WorkChat, observation: Ack): NativeIdentity {
  if (observation.attempt !== chat.attemptId || observation.error || observation.lifecycle === 'shutdown'
    || !observation.lifecycle || observation.lifecycle.startsWith('start:new') || observation.lifecycle.startsWith('start:fork')
    || observation.cwd !== chat.worktree || observation.processCwd !== chat.worktree
    || observation.installation !== chat.installation || observation.state !== chat.statePath) {
    throw new InputError('Native work-chat acknowledgement changed or is blocked');
  }
  if (!observation.sessionId || !observation.historyPath || !isAbsolute(observation.historyPath)
    || !within(join(chat.statePath, 'sessions'), observation.historyPath)
    || (chat.sessionId && chat.sessionId !== observation.sessionId)
    || (chat.historyPath && chat.historyPath !== observation.historyPath)) throw new InputError('Native session changed');
  return { sessionId: observation.sessionId, historyPath: observation.historyPath };
}

/** Node24 adapter: all external observations are fail-closed, no polling daemon. */
export function nativeChatRuntime(input: { pi: string; userHome: string; agentDir: string; nodePath: string; installation: string; statePath: string; identity: (projectId: number) => string }): ChatRuntime {
  const installation = realpathSync(input.installation);
  const pi = realpathSync(input.pi);
  const state = resolve(input.statePath);
  if (state !== realpathSync(state) || !statSync(state).isDirectory()) throw new InputError('Canonical existing Pi state directory required');
  const agentDir = realpathSync(input.agentDir);
  const env = { ...process.env, XDG_STATE_HOME: state, PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: '1', PATH: dirname(input.nodePath) + ':' + process.env.PATH };
  function target(binding: Pick<ChatBinding, 'installation' | 'statePath' | 'worktree'>) {
    if (binding.installation !== installation || binding.statePath !== state || !existsSync(join(installation, 'dist', 'src', 'app', 'startup-extension.js'))
      || !existsSync(join(agentDir, 'settings.json')) || !existsSync(join(input.userHome, 'USER-INSTRUCTIONS.md'))) {
      throw new InputError('Target Pi installation/state/resources unavailable');
    }
    const settings = json(readFileSync(join(agentDir, 'settings.json'), 'utf8'));
    if (!Array.isArray(settings.packages) || settings.packages.filter(path => path === join(installation, 'integrations', 'pi')).length !== 1) {
      throw new InputError('Target Pi package not uniquely configured in agent resources');
    }
    return binding.worktree;
  }
  function shell(value: string): string { return "'" + value.replaceAll("'", "'\"'\"'") + "'"; }
  const runtime: ChatRuntime = {
    launchCommitted(chat) {
      // Merely wakes one in-tab follow-up; the receipt and DB are checked again.
      writeFileSync(join(state, 'mypi', 'work-chat-acks', chat.attemptId + '-committed'), '',
        { flag: 'wx', mode: 0o600 });
    },
    receiptMatches(chat, model, generation, adopt) {
      try {
        const latest = ack(chat);
        return latest?.attempt === chat.attemptId && latest.generation === generation
          && latest.sessionId === chat.sessionId && latest.historyPath === chat.historyPath
          && latest.processId === chat.processId && latest.cwd === chat.worktree
          && latest.processCwd === chat.worktree && latest.installation === installation
          && latest.state === state && latest.scope === input.identity(chat.projectId)
          && latest.authReady === true && !latest.error && !latest.lifecycle.startsWith('shutdown:')
          && (!adopt || latest.lifecycle === 'adopt:confirm')
          && latest.model?.provider === model.provider && latest.model.model === model.model
          && processStart(chat.processId!) === chat.processStart;
      } catch { return false; }
    },
    async validate(args) {
      const sourceClone = realpathSync(args.sourceClone), worktree = realpathSync(args.worktree);
      if (sourceClone !== args.sourceClone || worktree !== args.worktree || args.installation !== installation || args.statePath !== state
        || sourceClone === installation || worktree === installation || sourceClone === worktree) throw new InputError('Noncanonical or installed-engine worktree binding');
      if (git(sourceClone, 'rev-parse', '--is-bare-repository') !== 'false'
        || git(sourceClone, 'rev-parse', '--show-toplevel') !== sourceClone
        || git(worktree, 'rev-parse', '--show-toplevel') !== worktree) throw new InputError('Source/worktree is not a Git checkout');
      const common = realpathSync(resolve(sourceClone, git(sourceClone, 'rev-parse', '--git-common-dir')));
      if (realpathSync(resolve(worktree, git(worktree, 'rev-parse', '--git-common-dir'))) !== common) throw new InputError('Foreign Git worktree');
      const branch = git(worktree, 'symbolic-ref', '--quiet', '--short', 'HEAD');
      if (!branch || git(sourceClone, 'worktree', 'list', '--porcelain').split('\n').filter(line => line === `worktree ${worktree}`).length !== 1) throw new InputError('Worktree is not registered on a branch');
      target(args);
      return { sourceClone, worktree, gitCommonDir: common, branch, installation, statePath: state };
    },
    async validateModel(pair, binding) {
      const cwd = target(binding);
      const auth = spawnSync(pi, ['auth', 'check', '--provider', pair.provider, '--model', pair.model,
        '--json', '--no-refresh'], { cwd, env, encoding: 'utf8', timeout: 7000, maxBuffer: 1024 * 1024 });
      if (auth.error || auth.signal || (auth.status !== 0 && auth.status !== 1)) throw new InputError('Target Pi auth check unavailable or invalid');
      const response = json(auth.stdout);
      // Pi 1.0.4 lists only authenticated models. A missing credential makes
      // even a valid target invisible; validate the exact catalog after /login.
      if (auth.status === 1 && response.status === 'not_ready' && response.provider === pair.provider) return 'auth-pending';
      if (auth.status !== 0 || !readyAuth(auth.stdout, pair.provider)) {
        throw new InputError('Target Pi auth check inconsistent; inspect provider/model configuration');
      }
      const catalog = command(pi, ['--offline', '--list-models'], cwd, env);
      if (!exactCatalogModel(catalog, pair)) throw new InputError(`Exact target model unavailable: ${pair.provider}/${pair.model}`);
      return 'ready';
    },
    async history(chat) {
      const path = chat.historyPath;
      if (!path || !chat.sessionId || !isAbsolute(path) || !within(join(state, 'sessions'), path) || !existsSync(path)
        || !statSync(path).isFile() || realpathSync(path) !== path) throw new InputError('Exact native history unavailable');
      const saved = nativeHistory(readFileSync(path, 'utf8'), chat.sessionId, chat.worktree,
        { installation, state, scope: input.identity(chat.projectId) });
      return { native: { sessionId: chat.sessionId, historyPath: path }, saved };
    },
    async provenEmpty(chat) {
      if (chat.phase === 'closed' || !chat.sessionId || !chat.historyPath || !isAbsolute(chat.historyPath)
        || !within(join(state, 'sessions'), chat.historyPath) || existsSync(chat.historyPath)) return false;
      try {
        const initial = ack(chat, true), final = ack(chat);
        if (!initial || !final || !startupReceipt(initial, { processId: chat.processId!, scope: input.identity(chat.projectId), ...(initial.model ? { model: initial.model } : {}), ...(initial.authReady !== undefined ? { authReady: initial.authReady } : {}) })
          || initial.fileExists || !final.provenEmpty || final.everPersisted || !final.continuous || final.lifecycle !== 'shutdown:quit'
          || final.attempt !== chat.attemptId || final.sessionId !== initial.sessionId || final.historyPath !== initial.historyPath
          || final.sessionId !== chat.sessionId || final.historyPath !== chat.historyPath
          || final.processId !== chat.processId || final.cwd !== chat.worktree || final.processCwd !== chat.worktree
          || final.installation !== installation || final.state !== state || final.scope !== input.identity(chat.projectId)) return false;
        return (await runtime.inspect(chat)).status === 'dead';
      } catch { return false; }
    },
    async inspect(chat): Promise<ChatInspection> {
      if (chat.phase === 'closed') return { status: 'dead', reason: 'Retired empty chat metadata' };
      let binding: Awaited<ReturnType<ChatRuntime['validate']>>;
      try { binding = await runtime.validate(chat); }
      catch (error) { return { status: 'unknown', reason: 'Git association unavailable: ' + String(error) }; }
      if (binding.gitCommonDir !== chat.gitCommonDir || binding.branch !== chat.branch) return { status: 'unknown', reason: 'Git association changed' };
      try { target(chat); }
      catch (error) { return { status: 'unknown', reason: 'Target Pi resources changed: ' + String(error) }; }
      let observation: Ack | undefined;
      try { observation = ack(chat); } catch { return { status: 'unknown', reason: 'Invalid native acknowledgement' }; }
      if (!chat.pane) return { status: 'unknown', reason: 'No correlated Herdr pane; inspect attempt' };
      let info: Record<string, unknown>;
      try { info = json(command('herdr', ['pane', 'process-info', '--pane', chat.pane], chat.worktree)); }
      catch { return { status: 'unknown', reason: 'Herdr cannot establish pane ownership' }; }
      const result = info.result as { process_info?: { foreground_processes?: { pid: number; cwd: string; cmdline: string }[] } } | undefined;
      const processes = result?.process_info?.foreground_processes;
      if (!processes || !Array.isArray(processes)) return { status: 'unknown', reason: 'Herdr process observation unavailable' };
      const pid = chat.processId;
      if (!pid || !chat.processStart) return { status: 'unknown', reason: 'Process identity missing' };
      const occupant = processes.find(p => p.pid === pid);
      if (!occupant) return inspectAbsentPaneProcess(pid);
      try {
        if (processStart(pid) !== chat.processStart || occupant.cwd !== chat.worktree || !occupant.cmdline.includes(pi)) return { status: 'unknown', reason: 'Pane process identity changed' };
        if (!observation || observation.processId !== pid) return { status: 'unknown', reason: 'Missing native acknowledgement' };
        if (observation.lifecycle.startsWith('shutdown:')) return { status: 'unknown', reason: 'Native session is shutting down; wait for process death' };
        const native = identity(chat, observation);
        if (observation.scope !== input.identity(chat.projectId)) throw new InputError('Native scope changed');
        if (existsSync(native.historyPath)) {
          const file = readFileSync(native.historyPath, 'utf8');
          nativeHistory(file, native.sessionId, chat.worktree); // Exact v3 header and complete tree, not a second model authority while live.
          if (observation.branchBinding?.installation !== installation || observation.branchBinding.state !== state
            || observation.branchBinding.scope !== input.identity(chat.projectId)) throw new InputError('Native active branch binding changed');
          if (observation.authReady && (observation.branchModel?.provider !== observation.model?.provider || observation.branchModel?.model !== observation.model?.model)) {
            throw new InputError('Native active branch model changed without acknowledgement');
          }
        } else if (observation.everPersisted || observation.fileExists) throw new InputError('Persisted native history is missing');
        const requested = { provider: chat.requestedProvider, model: chat.requestedModel };
        const matches = observation.model?.provider === requested.provider && observation.model?.model === requested.model;
        const localAuth = observation.model ? await runtime.validateModel(observation.model, chat) : 'auth-pending';
        const readiness = observation.authReady && localAuth === 'ready' && (!chat.requestedProvider || matches)
          ? 'ready' : 'auth-pending';
        // Native registry/auth is only a local credential check; it makes no provider request.
        return { status: 'live', binding: chat, process: { pane: chat.pane, processId: pid, processStart: chat.processStart }, native, authorized: Boolean(observation.authReady && localAuth === 'ready'),
          generation: observation.generation, ...(observation.model ? { model: observation.model } : {}), readiness,
          ...(readiness === 'auth-pending' ? { reason: chat.requestedProvider && observation.model && localAuth === 'ready' ? `Expected ${chat.requestedProvider}/${chat.requestedModel}; selected ${observation.model.provider}/${observation.model.model}. Use /model or /work-chat adopt-model in this tab` : 'Local auth/model not ready; run /login in this same Pi session' } : {}),
          persisted: observation.everPersisted || observation.fileExists };
      } catch (error) { return { status: 'unknown', reason: String(error) }; }
    },
    async launch({ chat, model, resume, focus }) {
      const binding = await runtime.validate(chat);
      if (binding.branch !== chat.branch || binding.gitCommonDir !== chat.gitCommonDir) throw new InputError('Git association changed');
      const readiness = model.source === 'unselected' ? 'auth-pending' : await runtime.validateModel(model, chat);
      if (resume) await runtime.history(chat);
      const sessionId = resume ? chat.sessionId! : randomUUID();
      if (!resume && existsSync(join(state, 'sessions')) && readdirSync(join(state, 'sessions')).some(name => name.endsWith('_' + sessionId + '.jsonl'))) throw new InputError('Native session ID collision');
      const scope = input.identity(chat.projectId);
      if (!/^[a-z0-9._-]+\/[a-z0-9._-]+$/.test(scope)) throw new InputError('Invalid registered project scope');
      if (process.env.HERDR_ENV !== '1' || !process.env.HERDR_WORKSPACE_ID) throw new InputError('Persistent Herdr environment required');
      const tab = json(command('herdr', ['tab', 'create', '--workspace', process.env.HERDR_WORKSPACE_ID,
        '--cwd', chat.worktree, '--label', 'work-chat-' + chat.id.slice(0, 8), ...(focus ? ['--focus'] : ['--no-focus']),
        '--env', 'XDG_STATE_HOME=' + state, '--env', 'PI_CODING_AGENT_DIR=' + agentDir,
        '--env', 'PI_OFFLINE=1', '--env', 'MYPI_WORK_CHAT_PI=' + pi, '--env', 'PATH=' + env.PATH], chat.worktree));
      const pane = (tab.result as { root_pane?: { pane_id?: string } } | undefined)?.root_pane?.pane_id;
      if (!pane) return { status: 'partial', reason: 'Herdr tab creation returned no pane' };
      const args = ['--offline', '--session-dir', join(state, 'sessions'), ...(resume ? ['--session', chat.historyPath!] : ['--session-id', sessionId]),
        ...(readiness === 'ready' && model.source !== 'unselected' ? ['--provider', model.provider, '--model', model.model] : ['--mypi-chat-unpinned']), '--mypi-scope', scope, '--mypi-chat-attempt', chat.attemptId,
        '--mypi-chat-model', JSON.stringify(model.source === 'unselected' ? null : { provider: model.provider, model: model.model }),
        ...(resume && model.source === 'invocation' ? ['--mypi-chat-override'] : []),
        ...(existsSync(join(agentDir, 'APPEND_SYSTEM.md')) ? [] : ['--append-system-prompt', join(input.userHome, 'USER-INSTRUCTIONS.md')])];
      try {
        command('herdr', ['pane', 'run', pane, [pi, ...args].map(shell).join(' ')], chat.worktree);
      } catch (error) { return { status: 'partial', pane, reason: String(error) }; }
      // Bounded start observation, not a background monitor. Unknown leaves one reserved attempt.
      const until = Date.now() + 12000;
      let observedPid: number | undefined, start: string | undefined, receipt: Ack | undefined;
      while (Date.now() < until) {
        try {
          const info = json(command('herdr', ['pane', 'process-info', '--pane', pane], chat.worktree));
          const processes = (info.result as { process_info?: { foreground_processes?: { pid: number; cwd: string; cmdline: string }[] } })?.process_info?.foreground_processes;
          const process = processes?.find(p => p.cmdline.includes(pi) && p.cwd === chat.worktree);
          if (process) { observedPid = process.pid; start = processStart(process.pid); }
          receipt = ack(chat, true);
          if (observedPid && start && receipt) break;
        } catch { /* Keep the exact returned pane on uncertain observation. */ }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
      }
      if (!receipt || !observedPid || !start) return { status: 'partial', pane,
        ...(observedPid ? { processId: observedPid } : {}), ...(start ? { processStart: start } : {}),
        reason: 'Native acknowledgement or Herdr process observation unavailable' };
      try {
        if (!startupReceipt(receipt, { processId: observedPid, scope, ...(readiness === 'ready' && model.source !== 'unselected' ? { model } : { allowUnpinned: true }) })) throw new InputError('Native model/scope/history or process not acknowledged');
        const native = identity(chat, receipt);
        if (resume && (native.sessionId !== chat.sessionId || native.historyPath !== chat.historyPath)) throw new InputError('Foreign native session');
        return { status: 'acknowledged', process: { pane, processId: observedPid, processStart: start }, native,
          readiness, ...(receipt.model ? { model: receipt.model } : {}) };
      } catch (error) { return { status: 'partial', pane, processId: observedPid, processStart: start, reason: String(error) }; }
    },
  };
  return runtime;
}
