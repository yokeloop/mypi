import { claimFor } from './delivery.js';
import type { EventTransports } from './delivery.js';
import type { SessionRunner } from './session-operations.js';
import type { Agent, DeviceSessions } from '../modules/sessions/public.js';

export type SubscriptionOptions = { server: { url: string; token: string }; pid: number; agent: Agent; runner: SessionRunner;
  device: Pick<DeviceSessions, 'start' | 'records'>; transports: EventTransports;
  fetch: (url: string, init: RequestInit) => Promise<Response>; pause: (ms: number) => Promise<void>; signal: AbortSignal };

export async function subscribeInbox(o: SubscriptionOptions): Promise<void> {
  const startOf = (): string | undefined => { try { return o.device.start(o.pid); } catch { return undefined; } };
  const start = startOf();
  if (start === undefined) return;
  const alive = () => startOf() === start;
  let retry = 2000, dirty = false;
  let inFlight: Promise<void> | undefined;
  const claim = async () => {
    try {
      const record = o.device.records().find(r => r.pid === o.pid && r.start === start && r.agent === o.agent);
      if (record !== undefined) await claimFor(o.runner, record.key, [record], o.transports);
    } catch { return; }
  };
  const loop = async () => {
    do { dirty = false; await claim(); } while (dirty);
    inFlight = undefined;
  };
  const kick = () => {
    if (inFlight !== undefined) { dirty = true; return; }
    inFlight = loop();
  };
  while (!o.signal.aborted && alive()) {
    let response: Response | undefined;
    try {
      response = await o.fetch(o.server.url + '/v1/changes', { headers: { authorization: 'Bearer ' + o.server.token, accept: 'text/event-stream' },
        signal: o.signal });
    } catch { response = undefined; }
    if (o.signal.aborted) break;
    if (response === undefined || response.status !== 200 || response.body === null) {
      try { await response?.body?.cancel(); } catch { response = undefined; }
      await o.pause(retry);
      continue;
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', type = '', gone = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
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
    if (gone || o.signal.aborted) break;
    await o.pause(retry);
  }
  await inFlight;
}
