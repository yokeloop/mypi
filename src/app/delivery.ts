import { createApp } from './create-app.js';
import { localTime } from './warmup.js';
import { frame } from '../modules/events/public.js';
import type { EventRow, EventTransport } from '../modules/events/public.js';
import type { Agent, RegistryRecord } from '../modules/sessions/public.js';

export type EventTransports = Partial<Record<Agent, EventTransport>> & { pause?: (ms: number) => Promise<void> };
export type Claim = { sessionId: number; socket: string; transport: EventTransport; events: EventRow[] };

export async function sendClaimed(app: ReturnType<typeof createApp>, claim: Claim): Promise<number[]> {
  const all = claim.events.map(e => e.id);
  let answer: number[];
  try {
    answer = await claim.transport(claim.socket, claim.events.map(e => ({ id: e.id, text: frame(e, localTime(e.createdAt)) })));
  } catch {
    try { app.serialize(() => app.events.release(all, claim.sessionId)); } catch { return []; }
    return [];
  }
  const sent = new Set(all);
  const acked = answer.filter(id => sent.delete(id));
  app.serialize(() => { app.events.deliver(acked); app.events.release([...sent], claim.sessionId); });
  return acked;
}

export async function deliverPending(app: ReturnType<typeof createApp>, key: string, runtime: string | undefined,
  transports: EventTransports, proc = '/proc'): Promise<number[]> {
  try {
    const sessions = app.sessions(runtime, proc);
    const claim = app.serialize((): Claim | undefined => {
      const { row, live } = sessions.lookup(key);
      const transport = live === undefined ? undefined : transports[live.agent];
      if (row === undefined || !live?.socket || transport === undefined) return undefined;
      const events = app.events.claim(key, row.id);
      return events.length === 0 ? undefined : { sessionId: row.id, socket: live.socket, transport, events };
    });
    if (claim === undefined) return [];
    return await sendClaimed(app, claim);
  } catch { return []; }
}

async function waitForLive(filename: string, key: string, transports: EventTransports, runtime: string | undefined, proc: string,
  wait: { deadlineMs: number; pollMs: number }): Promise<{ record: RegistryRecord; transport: EventTransport } | string> {
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
    return { record, transport };
  } catch (error) { return (error as Error).message; }
}

export async function deliverToStarted(filename: string, key: string, messages: { id: number; text: string }[], transports: EventTransports,
  runtime: string | undefined, proc = '/proc', wait = { deadlineMs: 10_000, pollMs: 200 }): Promise<string | null> {
  try {
    const found = await waitForLive(filename, key, transports, runtime, proc, wait);
    if (typeof found === 'string') return found;
    const acked = new Set(await found.transport(found.record.socket!, messages));
    return messages.every(m => acked.has(m.id)) ? null : 'the session did not accept it';
  } catch (error) { return (error as Error).message; }
}

export async function deliverOnOpen(filename: string, key: string, start: string | null, transports: EventTransports,
  runtime: string | undefined, proc = '/proc', wait = { deadlineMs: 10_000, pollMs: 200 }): Promise<{ rows: number[]; failure: string | null }> {
  const read = createApp(filename, true);
  let pending;
  try { pending = read.events.pending(key).filter(e => e.kind === 'message').map(e => e.id); } finally { read.close(); }
  if (start === null && pending.length === 0) return { rows: [], failure: null };
  const found = await waitForLive(filename, key, transports, runtime, proc, wait);
  if (typeof found === 'string') return { rows: pending, failure: found };
  const app = createApp(filename, false);
  try {
    const sessions = app.sessions(runtime, proc);
    const { sessionId, claimed } = app.serialize(() => {
      const { row, live } = sessions.lookup(key);
      const same = live !== undefined && live.pid === found.record.pid && live.start === found.record.start
        && live.agent === found.record.agent && live.nativeId === found.record.nativeId;
      return { sessionId: row?.id ?? 0, claimed: row !== undefined && same ? app.events.claim(key, row.id, { messagesOnly: true }) : [] };
    });
    const text = [...(start === null ? [] : [start]), ...claimed.map(e => frame(e, localTime(e.createdAt)))].join('\n\n');
    if (text === '') return { rows: [], failure: null };
    const ids = claimed.map(e => e.id);
    const id = claimed[0]?.id ?? 0;
    let failure: string | null;
    try {
      const acked = new Set(await found.transport(found.record.socket!, [{ id, text }]));
      failure = acked.has(id) ? null : 'the session did not accept it';
    } catch (error) { failure = (error as Error).message; }
    if (ids.length > 0) {
      if (failure === null) app.serialize(() => app.events.deliver(ids));
      else app.serialize(() => app.events.release(ids, sessionId));
    }
    return { rows: ids, failure };
  } finally { app.close(); }
}
