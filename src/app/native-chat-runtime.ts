import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { InputError } from '../shared/errors.js';
import type { ChatRuntime, ChatInspection } from './work-chats.js';
import { nativeHistory, nativeHistoryFacts } from './native-chat-facts.js';
import { freshNativeModel, launchPreference, nativeArguments, nativeShellEnvironment, openingResult } from './native-chat-launch.js';
import { herdrExit, herdrResponse, localEndpoint, matchedPaneOutput, nativeAgent, nativeProcessIdentity, object, option, paneProcesses, procStart, resolvedPi } from './native-herdr-facts.js';
import { linuxBootId, readNativeProcess } from './native-chat-process.js';
import { nativeOwnership, ownershipRoute, type AgentObservation, type ProcessAbsence } from './native-chat-ownership.js';
import type { NativeAgent } from './native-herdr-facts.js';
import { validateModelPair } from '../modules/work-chats/public.js';
import type { ChatBinding, NativeIdentity, ProcessIdentity, WorkChat } from '../modules/work-chats/public.js';

function command(binary: string, args: string[], cwd: string, env = process.env): string {
  const result = spawnSync(binary, args, { cwd, env, encoding: 'utf8', timeout: 7000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0 || result.signal) throw new InputError(`${basename(binary)} ${args[0]} unavailable`);
  return result.stdout;
}
function git(cwd: string, ...args: string[]): string { return command('git', args, cwd).trim(); }
function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return !!path && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}
function processStart(pid: number, readStat: (path: string, encoding: 'utf8') => string = readFileSync): string {
  return procStart(readStat(`/proc/${pid}/stat`, 'utf8'));
}
/** PID reuse, permission errors and unavailable procfs never establish absence. */
export function inspectAbsentPaneProcess(pid: number, readStat?: (path: string, encoding: 'utf8') => string): ProcessAbsence {
  try {
    processStart(pid, readStat);
    return { status: 'unknown', reason: 'Recorded process still exists (possibly a reused PID)' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try { processStart(process.pid, readStat); return { status: 'dead' }; }
      catch { return { status: 'unknown', reason: 'Procfs availability unconfirmed' }; }
    }
    return { status: 'unknown', reason: 'Process absence unconfirmed' };
  }
}
function directExecutable(path: string): void {
  const fd = openSync(path, 'r');
  try {
    const magic = Buffer.alloc(4);
    if (readSync(fd, magic, 0, 4, 0) !== 4 || !magic.equals(Buffer.from([127, 69, 76, 70]))) {
      throw new InputError('MYPI_WORK_CHAT_PI must be the direct Linux Pi executable, not a shell wrapper');
    }
  } finally { closeSync(fd); }
}
function shellQuote(value: string): string { return "'" + value.replaceAll("'", "'\"'\"'") + "'"; }

/** Native history and stock Herdr observations; no startup receipts or auth mirror. */
export function nativeChatRuntime(input: { pi: string; userHome: string; agentDir: string; nodePath: string; installation: string; statePath: string; identity: (projectId: number) => string }): ChatRuntime {
  const installation = realpathSync(input.installation), pi = realpathSync(input.pi);
  const state = resolve(input.statePath), agentDir = realpathSync(input.agentDir);
  if (state !== realpathSync(state) || !statSync(state).isDirectory()) throw new InputError('Canonical existing Pi state directory required');
  const env = { ...process.env, XDG_STATE_HOME: state, PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: '1', PATH: dirname(pi) + ':' + dirname(input.nodePath) + ':' + process.env.PATH };
  function target(binding: Pick<ChatBinding, 'installation' | 'statePath' | 'worktree'>) {
    if (binding.installation !== installation || binding.statePath !== state || !existsSync(join(installation, 'dist', 'src', 'app', 'startup-extension.js'))
      || !existsSync(join(agentDir, 'settings.json')) || !existsSync(join(input.userHome, 'USER-INSTRUCTIONS.md'))) {
      throw new InputError('Target Pi installation/state/resources unavailable');
    }
    const settings = object(JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')));
    if (!Array.isArray(settings.packages) || settings.packages.filter(path => path === join(installation, 'integrations', 'pi')).length !== 1) {
      throw new InputError('Target Pi package not uniquely configured in agent resources');
    }
    return binding.worktree;
  }
  function extension(): string {
    const path = realpathSync(process.env.MYPI_WORK_CHAT_HERDR_EXTENSION ?? join(homedir(), '.pi', 'agent', 'extensions', 'herdr-agent-state.ts'));
    const text = readFileSync(path, 'utf8');
    if (!text.includes('// installed by herdr') || !text.includes('// HERDR_INTEGRATION_ID=pi') || !text.includes('pane.report_agent_session')) {
      throw new InputError('Installed stock Herdr Pi session integration required; configure MYPI_WORK_CHAT_HERDR_EXTENSION');
    }
    return path;
  }
  function herdrCommand(args: string[], cwd: string, endpoint: string, timeout = 7000) {
    const result = spawnSync('herdr', args, { cwd, env: { ...process.env, HERDR_SOCKET_PATH: localEndpoint(endpoint) }, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
    if (result.error || result.signal) throw new InputError('Herdr transport unavailable; action may have occurred');
    return result;
  }
  function herdr(args: string[], cwd: string, endpoint: string, timeout = 7000): Record<string, unknown> {
    const result = herdrCommand(args, cwd, endpoint, timeout);
    return herdrResponse(result.stdout, result.stderr, result.status);
  }
  function agents(chat: WorkChat, endpoint: string): NativeAgent[] {
    const result = herdr(['agent', 'list'], chat.worktree, endpoint);
    if (!Array.isArray(result.agents)) throw new InputError('Herdr agent list unavailable');
    return result.agents.map(nativeAgent);
  }
  function processes(chat: WorkChat, pane: string, endpoint: string) {
    return paneProcesses(herdr(['pane', 'process-info', '--pane', pane], chat.worktree, endpoint));
  }
  function native(chat: WorkChat, path: string): { native: NativeIdentity; persisted: boolean; saved: ReturnType<typeof nativeHistory> } {
    if (!chat.sessionId || !isAbsolute(path) || resolve(path) !== path || !within(join(state, 'sessions'), path)
      || (chat.historyPath && chat.historyPath !== path)) throw new InputError('Native history path changed');
    // An unsaved native path is valid metadata, not proof of resumable/empty history.
    if (!existsSync(path)) {
      let ancestor = dirname(path);
      while (!existsSync(ancestor)) ancestor = dirname(ancestor);
      if (realpathSync(ancestor) !== ancestor || !basename(path).endsWith('_' + chat.sessionId + '.jsonl')) throw new InputError('Unconfirmed native session ID/path');
      return { native: { sessionId: chat.sessionId, historyPath: path }, persisted: false, saved: { status: 'none' } };
    }
    if (!statSync(path).isFile() || realpathSync(path) !== path) throw new InputError('Exact native history unavailable');
    const saved = nativeHistory(readFileSync(path, 'utf8'), chat.sessionId, chat.worktree,
      { installation, state, scope: input.identity(chat.projectId) });
    return { native: { sessionId: chat.sessionId, historyPath: path }, persisted: true, saved };
  }
  function processIdentity(chat: WorkChat, pane: string, pid: number, endpoint: string): ProcessIdentity {
    const snapshot = readNativeProcess(pid);
    if (option(snapshot.argv, '--session') && (!chat.historyPath || !existsSync(chat.historyPath))) throw new InputError('Resumed native history is missing');
    return nativeProcessIdentity(snapshot, chat, { pi, agentDir, scope: input.identity(chat.projectId), endpoint, pane });
  }

  function live(chat: WorkChat, candidate: NativeAgent, endpoint: string): ChatInspection {
    const fresh = nativeAgent(herdr(['agent', 'get', candidate.pane], chat.worktree, endpoint).agent);
    if (fresh.kind !== 'pi' || fresh.cwd !== chat.worktree || !fresh.sessionPath) throw new InputError('Native agent type/cwd/session metadata unavailable');
    const history = native(chat, fresh.sessionPath);
    const foreground = processes(chat, fresh.pane, endpoint).processes;
    if (foreground.length !== 1) throw new InputError('Native foreground process is ambiguous');
    const process = processIdentity(chat, fresh.pane, foreground[0]!.pid, endpoint);
    const last = nativeAgent(herdr(['agent', 'get', fresh.pane], chat.worktree, endpoint).agent);
    if (last.sessionPath !== fresh.sessionPath || last.kind !== fresh.kind || last.cwd !== fresh.cwd) throw new InputError('Native session switched during observation');
    return { status: 'live', binding: chat, process, native: history.native, persisted: history.persisted,
      ...(history.saved.status === 'selected' ? { model: history.saved.selection } : {}) };
  }
  function shellReady(chat: WorkChat, pane: string, endpoint: string): { pid: number; start: string } {
    const info = processes(chat, pane, endpoint);
    if (!Number.isSafeInteger(info.shellPid) || info.shellPid <= 0 || info.foregroundGroup !== info.shellPid
      || info.processes.length !== 1 || info.processes[0]!.pid !== info.shellPid || info.processes[0]!.cwd !== chat.worktree) {
      throw new InputError('Owned pane is not at an available shell prompt');
    }
    if (realpathSync(`/proc/${info.shellPid}/cwd`) !== chat.worktree) throw new InputError('Owned shell cwd changed');
    const shell = basename(realpathSync(`/proc/${info.shellPid}/exe`));
    if (!['bash', 'zsh', 'dash', 'sh'].includes(shell)) throw new InputError('Pi executable preflight requires a supported POSIX shell (bash/zsh/dash/sh)');
    return { pid: info.shellPid, start: processStart(info.shellPid) };
  }
  function resolveInShell(chat: WorkChat, pane: string, endpoint: string): void {
    const before = shellReady(chat, pane, endpoint);
    const directory = mkdtempSync(join(tmpdir(), 'mypi-pi-resolution-'));
    const output = join(directory, 'path'), marker = randomUUID();
    try {
      // Resolution only, NEVER a Pi launcher. Split marker avoids matching terminal input echo.
      const probe = `(umask 077; command -v pi > ${shellQuote(output)}; printf '\\n%s%s\\n' ${shellQuote(marker.slice(0, 18))} ${shellQuote(marker.slice(18))})`;
      // Herdr 0.8.2 pane run has empty stdout on success. wait-output/focus return JSON.
      const sent = herdrCommand(['pane', 'run', pane, probe], chat.worktree, endpoint);
      herdrExit(sent.stderr, sent.status);
      matchedPaneOutput(herdr(['pane', 'wait-output', pane, '--match', marker, '--timeout', '3000'], chat.worktree, endpoint, 4000), pane);
      if (realpathSync(resolvedPi(readFileSync(output, 'utf8'))) !== pi) throw new InputError('Target shell resolves pi to another executable; configure its PATH without the global-mutating wrapper');
      const after = shellReady(chat, pane, endpoint);
      if (after.pid !== before.pid || after.start !== before.start) throw new InputError('Shell changed during Pi executable preflight');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  const runtime: ChatRuntime = {
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
      target(binding);
      validateModelPair({ provider: pair.provider, model: pair.model }, 'launch preference');
      // Syntax/resources only: Pi's catalog is auth-filtered, so absence cannot
      // establish invalidity. Exact application is confirmed after native start.
    },
    async history(chat) {
      if (!chat.historyPath || !existsSync(chat.historyPath)) throw new InputError('Exact native history unavailable');
      const result = native(chat, chat.historyPath);
      return { native: result.native, saved: result.saved };
    },
    async provenEmpty() { return false; },
    async inspect(chat): Promise<ChatInspection> {
      try {
        const binding = await runtime.validate(chat);
        if (binding.gitCommonDir !== chat.gitCommonDir || binding.branch !== chat.branch) throw new InputError('Git association changed');
        const route = ownershipRoute(chat, process.env.HERDR_SOCKET_PATH, linuxBootId());
        const observations = new Map<string, AgentObservation>();
        for (const endpoint of new Set([route.origin, route.current])) {
          try { observations.set(endpoint, { agents: agents(chat, endpoint) }); }
          catch (error) { observations.set(endpoint, { error: String(error) }); }
        }
        const decision = nativeOwnership(chat, route, observations,
          chat.processId ? inspectAbsentPaneProcess(chat.processId) : { status: 'unknown' });
        return decision.status === 'candidate' ? live(chat, decision.agent, decision.endpoint) : decision;
      } catch (error) { return { status: 'unknown', reason: String(error) }; }
    },
    async focus(chat, observation) {
      const fresh = await runtime.inspect(chat);
      if (fresh.status !== 'live' || !fresh.process || !fresh.native || !observation.process || !observation.native
        || fresh.process.processId !== observation.process.processId || fresh.process.processStart !== observation.process.processStart
        || fresh.process.processBootId !== observation.process.processBootId || fresh.process.herdrEndpoint !== observation.process.herdrEndpoint
        || fresh.native.sessionId !== observation.native.sessionId || fresh.native.historyPath !== observation.native.historyPath) {
        throw new InputError('Native chat changed before focus');
      }
      herdr(['agent', 'focus', fresh.process.pane], chat.worktree, fresh.process.herdrEndpoint!);
    },
    async prepareLaunch({ chat, model, resume, focus }) {
      const binding = await runtime.validate(chat);
      if (binding.branch !== chat.branch || binding.gitCommonDir !== chat.gitCommonDir) throw new InputError('Git association changed');
      directExecutable(pi);
      const stock = extension();
      if (resume) await runtime.history(chat);
      const previousEntries = resume && model.source === 'invocation'
        ? nativeHistoryFacts(readFileSync(chat.historyPath!, 'utf8'), chat.sessionId!, chat.worktree).entryIds : undefined;
      if (!chat.sessionId) throw new InputError('Preassigned native session ID required');
      if (!resume && existsSync(join(state, 'sessions')) && readdirSync(join(state, 'sessions')).some(name => name.endsWith('_' + chat.sessionId + '.jsonl'))) throw new InputError('Native session ID collision');
      const scope = input.identity(chat.projectId);
      if (!/^[a-z0-9._-]+\/[a-z0-9._-]+$/.test(scope)) throw new InputError('Invalid registered project scope');
      const endpoint = localEndpoint(process.env.HERDR_SOCKET_PATH), workspace = process.env.HERDR_WORKSPACE_ID;
      if (process.env.HERDR_ENV !== '1' || !workspace) throw new InputError('Persistent Herdr environment required');
      const args = nativeArguments({ chat, model, resume, extension: stock, scope,
        ...(existsSync(join(agentDir, 'APPEND_SYSTEM.md')) ? {} : { instructions: join(input.userHome, 'USER-INSTRUCTIONS.md') }) });
      if (agents(chat, endpoint).some(agent => agent.cwd === chat.worktree || chat.historyPath && agent.sessionPath === chat.historyPath)) throw new InputError('Worktree/session already has a native agent; inspect before opening');
      const shellEnvironment = nativeShellEnvironment(process.env);
      // Capture checked configuration; never rediscover deterministic prerequisites after SQL reservation.
      return async () => {
        let pane: string | undefined, observedProcess: ProcessIdentity | undefined, found: NativeIdentity | undefined;
        try {
          const tab = herdr(['tab', 'create', '--workspace', workspace, '--cwd', chat.worktree,
            '--label', 'work-chat-' + chat.id.slice(0, 8), ...(focus ? ['--focus'] : ['--no-focus']),
            '--env', 'XDG_STATE_HOME=' + state, '--env', 'PI_CODING_AGENT_DIR=' + agentDir,
            '--env', 'PI_OFFLINE=1', '--env', 'MYPI_WORK_CHAT_PI=' + pi, '--env', 'PATH=' + env.PATH,
            ...shellEnvironment], chat.worktree, endpoint);
          const root = object(tab.root_pane);
          if (typeof root.pane_id !== 'string' || !root.pane_id) throw new InputError('Herdr tab creation returned no pane; do not repeat create');
          pane = root.pane_id;
          resolveInShell(chat, pane, endpoint);
          let failure: unknown;
          try { herdr(['agent', 'start', 'chat-' + chat.attemptId.replaceAll('-', '').slice(0, 24), '--kind', 'pi', '--pane', pane, '--timeout', '15000', '--', ...args], chat.worktree, endpoint, 17000); }
          catch (error) { failure = error; }
          // Exactly one immediate native observation, not a custom readiness/ack loop.
          // Even a lost/blocked start response may already have opened this native chat.
          const observation = await runtime.inspect({ ...chat, pane, herdrEndpoint: endpoint });
          if (observation.status === 'live' && observation.process && observation.native) {
            observedProcess = observation.process; found = observation.native;
            let modelConfirmed = true;
            if (previousEntries) {
              const after = nativeHistoryFacts(readFileSync(found.historyPath, 'utf8'), found.sessionId, chat.worktree);
              modelConfirmed = freshNativeModel(previousEntries, after) && after.saved.status === 'selected'
                && after.saved.selection.provider === observation.model?.provider && after.saved.selection.model === observation.model?.model;
            }
            return openingResult(observation, launchPreference(model, resume), modelConfirmed);
          }
          try {
            const candidates = processes(chat, pane, endpoint).processes;
            if (candidates.length === 1) observedProcess = processIdentity(chat, pane, candidates[0]!.pid, endpoint);
          } catch { /* Preserve pane even when process correlation is incomplete. */ }
          try {
            const seen = nativeAgent(herdr(['agent', 'get', pane], chat.worktree, endpoint).agent);
            if (seen.kind === 'pi' && seen.cwd === chat.worktree && seen.sessionPath) found = native(chat, seen.sessionPath).native;
          } catch { /* Never attach an unvalidated native reference. */ }
          throw new InputError([failure ? String(failure) : '', observation.reason ?? 'Native identity not yet confirmed; inspect the same tab (including project trust)'].filter(Boolean).join('; '));
        } catch (error) {
          return { status: 'partial', reason: String(error), ...(pane ? { pane } : {}), ...(observedProcess ?? {}),
            herdrEndpoint: endpoint, ...(found ? { native: found } : {}) };
        }
      };
    },
  };
  return runtime;
}
