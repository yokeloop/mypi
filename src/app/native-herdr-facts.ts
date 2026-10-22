import { isAbsolute, normalize } from 'node:path';
import { InputError } from '../shared/errors.js';
import type { ProcessIdentity, WorkChat } from '../modules/work-chats/public.js';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Malformed Herdr observation');
  return value as Record<string, unknown>;
}
export function localEndpoint(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value || /[\x00-\x20?#]/.test(value)) {
    throw new InputError('Absolute normalized local HERDR_SOCKET_PATH required');
  }
  return value;
}
export class HerdrError extends InputError {
  constructor(message: string, readonly code?: string) { super(message); }
}
/** Exit-status actions (pane run) need no stdout payload; this does not prove completion. */
export function herdrExit(stderr: string, status: number | null): void {
  if (status !== 0) {
    let code: string | undefined;
    try { const error = object(object(JSON.parse(stderr)).error); if (typeof error.code === 'string') code = error.code; } catch { /* Transport/syntax failure is not pane absence. */ }
    throw new HerdrError(`Herdr observation/action failed${code ? ': ' + code : ' (transport or invalid response)'}`, code);
  }
}
export function herdrResponse(stdout: string, stderr: string, status: number | null): Record<string, unknown> {
  herdrExit(stderr, status);
  return object(object(JSON.parse(stdout)).result);
}
export function matchedPaneOutput(result: Record<string, unknown>, pane: string): void {
  if (result.type !== 'output_matched' || result.pane_id !== pane) throw new InputError('Herdr shell resolution completion unconfirmed');
}
export interface NativeAgent { pane: string; cwd?: string; kind?: string; sessionPath?: string }
export function nativeAgent(value: unknown): NativeAgent {
  const agent = object(value);
  if (typeof agent.pane_id !== 'string' || !agent.pane_id) throw new InputError('Missing Herdr pane identity');
  const session = agent.agent_session == null ? undefined : object(agent.agent_session);
  const cwd = agent.foreground_cwd ?? agent.cwd;
  return { pane: agent.pane_id, ...(typeof cwd === 'string' ? { cwd } : {}),
    ...(typeof agent.agent === 'string' ? { kind: agent.agent } : {}),
    ...(session?.source === 'herdr:pi' && session.agent === 'pi' && session.kind === 'path' && typeof session.value === 'string'
      ? { sessionPath: session.value } : {}) };
}
export interface PaneProcesses { shellPid: number; foregroundGroup: number; processes: { pid: number; cwd?: string }[] }
export function paneProcesses(result: Record<string, unknown>): PaneProcesses {
  const info = object(result.process_info);
  if (!Array.isArray(info.foreground_processes)) throw new InputError('Herdr foreground process observation unavailable');
  return { shellPid: Number(info.shell_pid), foregroundGroup: Number(info.foreground_process_group_id),
    processes: info.foreground_processes.map(value => {
      const process = object(value);
      if (!Number.isSafeInteger(process.pid) || Number(process.pid) <= 0) throw new InputError('Invalid Herdr process');
      return { pid: Number(process.pid), ...(typeof process.cwd === 'string' ? { cwd: process.cwd } : {}) };
    }) };
}
export function procStart(text: string): string {
  const close = text.lastIndexOf(')');
  const tail = text.slice(close + 2).trim().split(/\s+/);
  if (close < 0 || text[close + 1] !== ' ' || !/^\d+$/.test(tail[19] ?? '')) throw new InputError('Malformed procfs process start');
  return tail[19]!;
}
/** Exact option values, never substring matches against a flattened command line. */
export function option(argv: readonly string[], name: string): string | undefined {
  const indices = argv.flatMap((value, index) => value === name ? [index] : []);
  if (indices.length !== 1) return undefined;
  return argv[indices[0]! + 1];
}
export interface NativeProcessSnapshot { pid: number; start: string; boot: string; executable: string; cwd: string; argv: string[]; env: Record<string, string> }
export function nativeProcessIdentity(snapshot: NativeProcessSnapshot, chat: WorkChat,
  expected: { pi: string; agentDir: string; scope: string; endpoint: string; pane: string }): ProcessIdentity {
  if (chat.processId !== null && (chat.processId !== snapshot.pid || chat.processStart !== snapshot.start)
    || chat.processBootId && chat.processBootId !== snapshot.boot || chat.herdrEndpoint && chat.herdrEndpoint !== expected.endpoint) {
    throw new InputError('Recorded process origin changed');
  }
  if (snapshot.executable !== expected.pi || snapshot.cwd !== chat.worktree) throw new InputError('Native process executable/cwd changed');
  if (snapshot.env.XDG_STATE_HOME !== chat.statePath || snapshot.env.PI_CODING_AGENT_DIR !== expected.agentDir
    || snapshot.env.HERDR_SOCKET_PATH !== expected.endpoint || option(snapshot.argv, '--mypi-scope') !== expected.scope
    || option(snapshot.argv, '--session-dir') !== chat.statePath + '/sessions'
    || !(option(snapshot.argv, '--session-id') === chat.sessionId || option(snapshot.argv, '--session') === chat.historyPath)) {
    throw new InputError('Native process installation/state/scope/session resources changed');
  }
  return { pane: expected.pane, processId: snapshot.pid, processStart: snapshot.start, processBootId: snapshot.boot, herdrEndpoint: expected.endpoint };
}
export function resolvedPi(output: string): string {
  const path = output.trimEnd();
  if (!isAbsolute(path) || path.includes('\n') || path.includes('\r') || path.includes('\0')) {
    throw new InputError('Target shell must resolve pi to one absolute executable, not an alias/function');
  }
  return path;
}
