import type { createApp } from './create-app.js';
import { localTime } from './warmup.js';
import { frame } from '../modules/events/public.js';
import type { EventTransport } from '../modules/events/public.js';
import type { Agent } from '../modules/sessions/public.js';

export type EventTransports = Partial<Record<Agent, EventTransport>>;

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
