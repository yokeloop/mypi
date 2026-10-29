import type { AppCommand } from './commands.js';
import { createApp } from './create-app.js';
import { WAITING_NOTIFICATIONS } from './session-input.js';
import { sessionKey } from './sessions.js';
import { localTime, warmupScope } from './warmup.js';
import { deliverPending } from './delivery.js';
import type { EventTransports } from './delivery.js';
import { frame, parentKey } from '../modules/events/public.js';

type Of<N extends AppCommand['name']> = Extract<AppCommand, { name: N }>;

export async function emitEvent(filename: string, c: Of<'event_emit'>, transports: EventTransports = {},
  proc = '/proc'): Promise<{ event: number | null; delivered: number[] }> {
  if (c.notification !== undefined && !(WAITING_NOTIFICATIONS as readonly string[]).includes(c.notification)) return { event: null, delivered: [] };
  const key = warmupScope(c.from, c.envScope, c.from === undefined && c.session !== undefined ? sessionKey(filename, c.session) : undefined);
  const app = createApp(filename, false);
  try {
    const { event } = app.events.emit({ from: key, kind: c.kind, message: c.message });
    if (event === null) return { event, delivered: [] };
    return { event, delivered: await deliverPending(app, parentKey(key)!, c.runtime ?? c.session?.runtime, transports, proc) };
  } finally { app.close(); }
}

export async function turnEnd(filename: string, c: Of<'turn_end'>, transports: EventTransports = {},
  proc = '/proc'): Promise<{ event: number | null; delivered: number[] }> {
  if (c.active) return { event: null, delivered: [] };
  return emitEvent(filename, { name: 'event_emit', kind: 'turn_end', message: c.message,
    session: { agent: 'claude', nativeId: c.nativeId, pid: c.pid, ...(c.runtime === undefined ? {} : { runtime: c.runtime }) },
    ...(c.envScope === undefined ? {} : { envScope: c.envScope }) }, transports, proc);
}

export function readInbox(filename: string, c: Of<'inbox'>) {
  const key = c.key ?? warmupScope(undefined, c.envScope, c.session === undefined ? undefined : sessionKey(filename, c.session));
  const app = createApp(filename, false);
  try {
    return app.serialize(() => {
      const events = app.events.pending(key === 'all' ? null : key);
      app.events.deliver(events.map(e => e.id));
      return { events: events.map(e => ({ id: e.id, from: e.fromKey, to: e.toKey, kind: e.kind, createdAt: e.createdAt,
        text: frame(e, localTime(e.createdAt)) })) };
    });
  } finally { app.close(); }
}
