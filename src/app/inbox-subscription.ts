import { claimFor } from './delivery.js';
import type { EventTransports } from './delivery.js';
import type { SessionOperationOutput, SessionRunner } from './session-operations.js';
import type { Agent, DeviceSessions } from '../modules/sessions/public.js';
import { KEEPALIVE_MS } from '../shared/change-stream.js';

export const IDLE_MS = KEEPALIVE_MS * 12 / 5;

export type SubscriptionOptions = { server: { url: string; token: string }; pid: number; agent: Agent; runner: SessionRunner;
  device: Pick<DeviceSessions, 'start' | 'records'>; transports: EventTransports;
  fetch: (url: string, init: RequestInit) => Promise<Response>; pause: (ms: number) => Promise<void>;
  timer: (ms: number, fire: () => void) => () => void; signal: AbortSignal };

export async function subscribeInbox(o: SubscriptionOptions): Promise<void> {
  const startOf = (): string | undefined => { try { return o.device.start(o.pid); } catch { return undefined; } };
  const start = startOf();
  if (start === undefined) return;
  const alive = () => startOf() === start;
  let retry = 2000, dirty = false;
  let inFlight: Promise<void> | undefined;
  const claim = async (): Promise<boolean> => {
    try {
      const record = o.device.records().find(r => r.pid === o.pid && r.start === start && r.agent === o.agent);
      if (record === undefined) return false;
      let claimed = 0;
      const runner: SessionRunner = { remote: o.runner.remote, device: o.runner.device, run: async (name, input) => {
        const result = await o.runner.run(name, input);
        if (name === 'events_claim') claimed = (result as SessionOperationOutput<'events_claim'>).events.length;
        return result;
      } };
      const acked = await claimFor(runner, record.key, [record], o.transports);
      return claimed > 0 && acked.length === 0;
    } catch { return false; }
  };
  const loop = async () => {
    do {
      dirty = false;
      if (await claim()) await o.pause(retry);
    } while (dirty && !o.signal.aborted);
    inFlight = undefined;
  };
  const kick = () => {
    if (inFlight !== undefined) { dirty = true; return; }
    inFlight = loop();
  };
  while (!o.signal.aborted && alive()) {
    const connection = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const arm = () => o.timer(IDLE_MS, () => { connection.abort(); reader?.cancel().catch(() => undefined); });
    let stop = arm();
    let response: Response | undefined;
    try {
      response = await o.fetch(o.server.url + '/v1/changes', { headers: { authorization: 'Bearer ' + o.server.token, accept: 'text/event-stream' },
        signal: AbortSignal.any([o.signal, connection.signal]) });
    } catch { response = undefined; }
    if (o.signal.aborted) { stop(); break; }
    if (response === undefined || response.status !== 200 || response.body === null) {
      stop();
      try { await response?.body?.cancel(); } catch { response = undefined; }
      await o.pause(retry);
      continue;
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', type = '', gone = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        stop();
        stop = arm();
        if (!alive()) { gone = true; await reader.cancel(); break; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop()!;
        for (const line of lines) {
          if (line === '') { if (type === 'change') kick(); type = ''; continue; }
          if (line.startsWith(':')) continue;
          const at = line.indexOf(':');
          const field = at === -1 ? line : line.slice(0, at);
          const text = at === -1 ? '' : line.slice(at + 1).replace(/^ /, '');
          if (field === 'retry' && /^[0-9]+$/.test(text) && Number(text) > 0) retry = Number(text);
          else if (field === 'event') type = text;
        }
      }
    } catch { gone = !alive(); }
    stop();
    if (gone || o.signal.aborted) break;
    await o.pause(retry);
  }
  await inFlight;
}
