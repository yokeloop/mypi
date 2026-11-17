import type { AppCommand } from './commands.js';
import { createApp } from './create-app.js';
import type { Agent } from '../modules/sessions/public.js';
import type { SessionHint } from './session-input.js';
import { sendClaimed } from './delivery.js';
import type { Claim, EventTransports } from './delivery.js';
import { warmupScope } from './warmup.js';

type Of<N extends AppCommand['name']> = Extract<AppCommand, { name: N }>;

export function registerSession(filename: string, c: Of<'session_register'>, proc = '/proc') {
  const app = createApp(filename, false);
  try {
    return app.sessions(c.runtime, proc).register({ agent: c.agent, nativeId: c.nativeId, pid: c.pid, name: c.sessionName ?? null,
      socket: c.socket ?? null, fork: c.fork, ...(c.envScope === undefined ? {} : { envScope: c.envScope }),
      ...(c.herdrName === undefined ? {} : { herdrName: c.herdrName }) });
  } finally { app.close(); }
}

export async function promptSession(filename: string, c: Of<'session_prompt'>, transports: EventTransports = {}, proc = '/proc'): Promise<void> {
  if (!c.counted) return;
  const app = createApp(filename, false);
  try {
    const sessions = app.sessions(c.runtime, proc);
    const claim = app.serialize((): Claim | undefined => {
      const prompted = sessions.prompt({ agent: c.agent, nativeId: c.nativeId });
      if (prompted.id === null) return undefined;
      const own = sessions.ownRecord(prompted.key!, { agent: c.agent, nativeId: c.nativeId });
      const transport = own === undefined ? undefined : transports[own.agent];
      if (!own?.socket || transport === undefined) return undefined;
      const events = app.events.claim(prompted.key!, prompted.id, { takeOver: true });
      return events.length === 0 ? undefined : { sessionId: prompted.id, socket: own.socket, transport, events };
    });
    if (claim !== undefined) await sendClaimed(app, claim);
  } finally { app.close(); }
}

export function unregisterSession(filename: string, c: Of<'session_unregister'>, proc = '/proc') {
  const app = createApp(filename, false);
  try { return app.sessions(c.runtime, proc).unregister(c.pid); } finally { app.close(); }
}

export function forgetSession(filename: string, c: Of<'session_forget'>, proc = '/proc') {
  const app = createApp(filename, false);
  try { return app.sessions(c.runtime, proc).forget(c.key); } finally { app.close(); }
}

export function listSessions(filename: string, c: Of<'sessions'>, proc = '/proc') {
  const app = createApp(filename, true);
  try { return { tree: app.sessions(c.runtime, proc).tree() }; } finally { app.close(); }
}

export function sessionKey(filename: string, hint: SessionHint, proc = '/proc'): string | undefined {
  const app = createApp(filename, true);
  try { return app.sessions(hint.runtime, proc).resolve(hint); } finally { app.close(); }
}

export function otherLiveSession(filename: string, key: string, caller: { pid: number; runtime?: string },
  hint?: { agent: Agent; nativeId: string }, proc = '/proc'): string | undefined {
  try {
    const app = createApp(filename, true);
    try {
      const sessions = app.sessions(caller.runtime, proc);
      const { records, rows } = sessions.lookup(key);
      const other = records.find(r => r.pid !== caller.pid
        && !(hint !== undefined && r.agent === hint.agent && r.nativeId === hint.nativeId));
      if (other === undefined) return undefined;
      const device = rows.find(x => x.agent === other.agent && x.nativeId === other.nativeId)?.device ?? sessions.device();
      return 'в этом скоупе уже есть живая сессия: ' + other.agent + ' на ' + device;
    } finally { app.close(); }
  } catch { return undefined; }
}

export function callerKey(filename: string, c: { envScope?: string; session?: SessionHint }): string | undefined {
  try {
    return warmupScope(undefined, c.envScope, c.session === undefined ? undefined : sessionKey(filename, c.session));
  } catch { return undefined; }
}
