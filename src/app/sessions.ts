import type { AppCommand } from './commands.js';
import { createApp, deviceSessions } from './create-app.js';
import type { Agent } from '../modules/sessions/public.js';
import type { SessionHint } from './session-input.js';
import type { SessionRunner } from './session-operations.js';
import { sendClaimed } from './delivery.js';
import type { EventTransports } from './delivery.js';
import { warmupScope } from './warmup.js';
import { pointerLine } from '../shared/switch-pointer.js';

type Of<N extends AppCommand['name']> = Extract<AppCommand, { name: N }>;

export async function registerSession(runner: SessionRunner, c: Of<'session_register'>, proc = '/proc') {
  const device = deviceSessions(c.runtime, proc);
  const prep = device.prepare({ agent: c.agent, nativeId: c.nativeId, pid: c.pid, fork: c.fork, ...(c.envScope === undefined ? {} : { envScope: c.envScope }) });
  const saved = await runner.run('session_save', { agent: c.agent, nativeId: c.nativeId, device: runner.device, candidateKey: prep.candidateKey,
    fork: c.fork, ...(c.envScope ? { envScope: c.envScope } : {}), otherLive: prep.otherLive, own: prep.own });
  if (saved.registered) device.record(saved.key, { agent: c.agent, nativeId: c.nativeId, pid: c.pid, start: prep.start, name: c.sessionName ?? null,
    socket: c.socket ?? null, ...(c.herdrName === undefined ? {} : { herdrName: c.herdrName }) });
  return saved;
}

type CommitsSince = (worktree: string, since: string) => number;

function commitsOrNull(commitsSince: CommitsSince, worktree: string, since: string): number | null {
  try { return commitsSince(worktree, since); } catch { return null; }
}

export async function promptSession(runner: SessionRunner, c: Of<'session_prompt'>, transports: EventTransports = {}, proc = '/proc',
  commitsSince?: CommitsSince): Promise<string> {
  if (!c.counted) return '';
  const own = deviceSessions(c.runtime, proc).ownRecord(c.agent, c.nativeId);
  const transport = own === undefined ? undefined : transports[own.agent];
  const claim = !c.noDeliver && Boolean(own?.socket) && transport !== undefined;
  const r = await runner.run('session_activate', { agent: c.agent, nativeId: c.nativeId, claim });
  if (r.id === null) return '';
  let line = '';
  if (r.switched !== null) {
    try {
      const commits = r.switched.device !== runner.device ? 'pull'
        : r.switched.worktree === null || commitsSince === undefined ? null : commitsOrNull(commitsSince, r.switched.worktree, r.switched.since);
      line = pointerLine({ ...r.switched, commits });
    } catch { line = ''; }
  }
  if (r.events.length > 0) {
    if (own!.key === r.key) await sendClaimed(runner, { sessionId: r.id, socket: own!.socket!, transport: transport!, events: r.events });
    else await runner.run('events_settle', { sessionId: r.id, acked: [], released: r.events.map(e => e.id) });
  }
  return line === '' ? '' : line + '\n';
}

export function unregisterSession(c: Of<'session_unregister'>, proc = '/proc') {
  return deviceSessions(c.runtime, proc).unregister(c.pid);
}

export async function forgetSession(runner: SessionRunner, c: Of<'session_forget'>, proc = '/proc') {
  const live = deviceSessions(c.runtime, proc).isLive(c.key);
  const { forgotten } = await runner.run('session_forget_rows', { key: c.key });
  return { forgotten, live };
}

export function listSessions(filename: string, c: Of<'sessions'>, proc = '/proc') {
  const app = createApp(filename, true);
  try { return { tree: app.sessions(c.runtime, proc).tree() }; } finally { app.close(); }
}

export async function sessionKey(runner: SessionRunner, hint: SessionHint, proc = '/proc'): Promise<string | undefined> {
  const { key } = await runner.run('session_key', { agent: hint.agent, nativeId: hint.nativeId });
  if (key !== null) return key;
  try { return deviceSessions(hint.runtime, proc).recordOf(hint.pid)?.key; } catch { return undefined; }
}

export function callerIdentity(hint: SessionHint, proc = '/proc'): { agent: Agent; nativeId: string } {
  try {
    const record = deviceSessions(hint.runtime, proc).recordOf(hint.pid);
    if (record !== undefined) return { agent: record.agent, nativeId: record.nativeId };
  } catch { return { agent: hint.agent, nativeId: hint.nativeId }; }
  return { agent: hint.agent, nativeId: hint.nativeId };
}

export function otherLiveSession(deviceName: string, key: string, caller: { pid: number; runtime?: string },
  hint?: { agent: Agent; nativeId: string }, proc = '/proc'): string | undefined {
  try {
    const other = deviceSessions(caller.runtime, proc).liveOf(key).find(r => r.pid !== caller.pid
      && !(hint !== undefined && r.agent === hint.agent && r.nativeId === hint.nativeId));
    return other === undefined ? undefined : 'в этом скоупе уже есть живая сессия: ' + other.agent + ' на ' + deviceName;
  } catch { return undefined; }
}

export async function callerKey(runner: SessionRunner, c: { envScope?: string; session?: SessionHint }): Promise<string | undefined> {
  try {
    return warmupScope(undefined, c.envScope, c.session === undefined ? undefined : await sessionKey(runner, c.session));
  } catch { return undefined; }
}
