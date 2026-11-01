import { createApp } from './create-app.js';
import { localTime } from './warmup.js';
import { frame } from '../modules/events/public.js';
import type { EventTransport } from '../modules/events/public.js';
import type { Agent, RegistryRecord } from '../modules/sessions/public.js';

export type EventTransports = Partial<Record<Agent, EventTransport>> & { pause?: (ms: number) => Promise<void> };

export async function deliverPending(app: ReturnType<typeof createApp>, key: string, runtime: string | undefined,
  transports: EventTransports, proc = '/proc'): Promise<number[]> {
  try {
    const record = app.sessions(runtime, proc).lookup(key).live;
    const transport = record === undefined ? undefined : transports[record.agent];
    if (!record?.socket || transport === undefined) return [];
    const events = app.events.pending(key).filter(e => e.kind !== 'milestone');
    if (events.length === 0) return [];
    const sent = new Set(events.map(e => e.id));
    const acked = (await transport(record.socket, events.map(e => ({ id: e.id, text: frame(e, localTime(e.createdAt)) }))))
      .filter(id => sent.delete(id));
    app.events.deliver(acked);
    return acked;
  } catch { return []; }
}

export async function deliverToStarted(filename: string, key: string, messages: { id: number; text: string }[], transports: EventTransports,
  runtime: string | undefined, proc = '/proc', wait = { deadlineMs: 10_000, pollMs: 200 }): Promise<string | null> {
  try {
    const until = Date.now() + wait.deadlineMs;
    let record: RegistryRecord | undefined;
    for (;;) {
      const app = createApp(filename, true);
      try { record = app.sessions(runtime, proc).lookup(key).live; } finally { app.close(); }
      if (record !== undefined && (record.socket || record.agent === 'claude')) break;
      if (transports.pause === undefined || Date.now() >= until) break;
      await transports.pause(wait.pollMs);
    }
    if (record === undefined) return 'no live session of ' + key + ' appeared within ' + wait.deadlineMs + ' ms';
    if (!record.socket) return 'the session has no event socket';
    const transport = transports[record.agent];
    if (transport === undefined) return 'no transport for ' + record.agent;
    const acked = new Set(await transport(record.socket, messages));
    return messages.every(m => acked.has(m.id)) ? null : 'the session did not accept it';
  } catch (error) { return (error as Error).message; }
}

export async function deliverOnOpen(filename: string, key: string, start: string | null, transports: EventTransports,
  runtime: string | undefined, proc = '/proc', wait = { deadlineMs: 10_000, pollMs: 200 }): Promise<{ rows: number[]; failure: string | null }> {
  const read = createApp(filename, true);
  let rows;
  try { rows = read.events.pending(key).filter(e => e.kind === 'message'); } finally { read.close(); }
  if (start === null && rows.length === 0) return { rows: [], failure: null };
  const id = rows[0]?.id ?? 0;
  const text = [...(start === null ? [] : [start]), ...rows.map(e => frame(e, localTime(e.createdAt)))].join('\n\n');
  const failure = await deliverToStarted(filename, key, [{ id, text }], transports, runtime, proc, wait);
  if (failure === null && rows.length > 0) {
    const app = createApp(filename, false);
    try { app.events.deliver(rows.map(r => r.id)); } finally { app.close(); }
  }
  return { rows: rows.map(r => r.id), failure };
}
