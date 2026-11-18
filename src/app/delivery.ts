import { deviceSessions } from './create-app.js';
import { localTime } from './warmup.js';
import { frame } from '../modules/events/public.js';
import type { EventRow, EventTransport } from '../modules/events/public.js';
import type { Agent, RegistryRecord } from '../modules/sessions/public.js';
import type { SessionRunner } from './session-operations.js';
import { PAGE_LIMIT_MAX } from '../shared/page.js';

export type EventTransports = Partial<Record<Agent, EventTransport>> & { pause?: (ms: number) => Promise<void> };
export type Claim = { sessionId: number; socket: string; transport: EventTransport; events: EventRow[] };

export async function sendClaimed(runner: SessionRunner, claim: Claim): Promise<number[]> {
  const all = claim.events.map(e => e.id);
  let answer: number[];
  try {
    answer = await claim.transport(claim.socket, claim.events.map(e => ({ id: e.id, text: frame(e, localTime(e.createdAt)) })));
  } catch {
    try { await runner.run('events_settle', { sessionId: claim.sessionId, acked: [], released: all }); } catch { return []; }
    return [];
  }
  const sent = new Set(all);
  const acked = answer.filter(id => sent.delete(id));
  await runner.run('events_settle', { sessionId: claim.sessionId, acked, released: [...sent] });
  return acked;
}

export async function claimFor(runner: SessionRunner, key: string, records: RegistryRecord[], transports: EventTransports): Promise<number[]> {
  const usable = records.filter(r => r.socket && transports[r.agent] !== undefined);
  if (usable.length === 0) return [];
  const claimed = await runner.run('events_claim', { key, live: usable.map(({ agent, nativeId }) => ({ agent, nativeId })) });
  if (claimed.sessionId === null || claimed.events.length === 0) return [];
  const record = usable.find(r => r.agent === claimed.agent && r.nativeId === claimed.nativeId)!;
  return sendClaimed(runner, { sessionId: claimed.sessionId, socket: record.socket!, transport: transports[record.agent]!, events: claimed.events });
}

export async function deliverPending(runner: SessionRunner, key: string, runtime: string | undefined,
  transports: EventTransports, proc = '/proc'): Promise<number[]> {
  try { return await claimFor(runner, key, deviceSessions(runtime, proc).liveOf(key), transports); } catch { return []; }
}

async function waitForLive(key: string, opened: { agent: Agent; nativeId: string }, transports: EventTransports, runtime: string | undefined, proc: string,
  wait: { deadlineMs: number; pollMs: number }): Promise<{ record: RegistryRecord; transport: EventTransport } | string> {
  try {
    const until = Date.now() + wait.deadlineMs;
    let record: RegistryRecord | undefined;
    for (;;) {
      record = deviceSessions(runtime, proc).ownRecord(opened.agent, opened.nativeId);
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

export async function deliverOnOpen(runner: SessionRunner, key: string, opened: { agent: Agent; nativeId: string }, start: string | null,
  transports: EventTransports, runtime: string | undefined, proc = '/proc', wait = { deadlineMs: 10_000, pollMs: 200 }):
  Promise<{ rows: number[]; failure: string | null }> {
  const pending = (await runner.run('event_list', { to: key, kind: 'message', delivered: false, limit: PAGE_LIMIT_MAX })).items.map(e => e.id).sort((a, b) => a - b);
  if (start === null && pending.length === 0) return { rows: [], failure: null };
  const found = await waitForLive(key, opened, transports, runtime, proc, wait);
  if (typeof found === 'string') return { rows: pending, failure: found };
  const claimed = await runner.run('events_claim', { key, live: [opened], messagesOnly: true });
  const text = [...(start === null ? [] : [start]), ...claimed.events.map(e => frame(e, localTime(e.createdAt)))].join('\n\n');
  if (text === '') return { rows: [], failure: null };
  const ids = claimed.events.map(e => e.id);
  const id = claimed.events[0]?.id ?? 0;
  let failure: string | null;
  try {
    const acked = new Set(await found.transport(found.record.socket!, [{ id, text }]));
    failure = acked.has(id) ? null : 'the session did not accept it';
  } catch (error) { failure = (error as Error).message; }
  if (ids.length > 0 && claimed.sessionId !== null) {
    await runner.run('events_settle', { sessionId: claimed.sessionId, acked: failure === null ? ids : [], released: failure === null ? [] : ids });
  }
  return { rows: ids, failure };
}
