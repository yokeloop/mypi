import type { AppCommand } from './commands.js';
import { createApp } from './create-app.js';
import { WAITING_NOTIFICATIONS } from './session-input.js';
import { sessionKey } from './sessions.js';
import { warmupScope } from './warmup.js';
import { frame } from '../modules/events/public.js';

type Of<N extends AppCommand['name']> = Extract<AppCommand, { name: N }>;

export function localTime(iso: string): string {
  const date = new Date(iso);
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

export function emitEvent(filename: string, c: Of<'event_emit'>): { event: number | null } {
  if (c.notification !== undefined && !(WAITING_NOTIFICATIONS as readonly string[]).includes(c.notification)) return { event: null };
  const key = warmupScope(c.from, c.envScope, c.from === undefined && c.session !== undefined ? sessionKey(filename, c.session) : undefined);
  const app = createApp(filename, false);
  try { return app.events.emit({ from: key, kind: c.kind, message: c.message }); } finally { app.close(); }
}

export function turnEnd(filename: string, c: Of<'turn_end'>): { event: number | null } {
  if (c.active) return { event: null };
  return emitEvent(filename, { name: 'event_emit', kind: 'turn_end', message: c.message,
    session: { agent: 'claude', nativeId: c.nativeId, pid: c.pid, ...(c.runtime === undefined ? {} : { runtime: c.runtime }) },
    ...(c.envScope === undefined ? {} : { envScope: c.envScope }) });
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
