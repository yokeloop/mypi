import type { AppCommand } from './commands.js';
import { createApp } from './create-app.js';
import { WAITING_NOTIFICATIONS } from './session-input.js';
import { callerKey, sessionKey } from './sessions.js';
import { localTime, warmupScope } from './warmup.js';
import { deliverPending } from './delivery.js';
import type { EventTransports } from './delivery.js';
import { inputText } from './input-text.js';
import { sendParentMessage } from './journal-facts.js';
import { InputError } from '../shared/errors.js';
import { claudeTurnPrompt } from '../infrastructure/transcript/claude-transcript.js';
import { frame, parentKey, parentSender, startedByParent } from '../modules/events/public.js';
import type { TurnPromptReader } from '../modules/events/public.js';

type Of<N extends AppCommand['name']> = Extract<AppCommand, { name: N }>;

export async function emitEvent(filename: string, c: Of<'event_emit'>, transports: EventTransports = {},
  proc = '/proc', readPrompt: TurnPromptReader = claudeTurnPrompt): Promise<{ event: number | null; delivered: number[] }> {
  if (c.notification !== undefined && !(WAITING_NOTIFICATIONS as readonly string[]).includes(c.notification)) return { event: null, delivered: [] };
  const key = warmupScope(c.from, c.envScope, c.from === undefined && c.session !== undefined ? sessionKey(filename, c.session) : undefined);
  const hooked = c.from === undefined && c.session !== undefined;
  let to = c.to;
  if (hooked) {
    const prompt = c.transcript === undefined ? undefined : readPrompt(c.transcript);
    if (parentKey(key) === undefined || !startedByParent(prompt)) return { event: null, delivered: [] };
    to = parentSender(prompt!.text);
  }
  const app = createApp(filename, false);
  try {
    const result = app.events.emit({ from: key, kind: c.kind, message: c.message, to });
    if (result.event === null) return { event: null, delivered: [] };
    return { event: result.event, delivered: await deliverPending(app, result.to!, c.runtime ?? c.session?.runtime, transports, proc) };
  } finally { app.close(); }
}

export async function turnEnd(filename: string, c: Of<'turn_end'>, transports: EventTransports = {},
  proc = '/proc', readPrompt: TurnPromptReader = claudeTurnPrompt): Promise<{ event: number | null; delivered: number[] }> {
  if (c.active) return { event: null, delivered: [] };
  return emitEvent(filename, { name: 'event_emit', kind: 'turn_end', message: c.message,
    session: { agent: 'claude', nativeId: c.nativeId, pid: c.pid, ...(c.runtime === undefined ? {} : { runtime: c.runtime }) },
    ...(c.envScope === undefined ? {} : { envScope: c.envScope }),
    ...(c.transcript === undefined ? {} : { transcript: c.transcript }) }, transports, proc, readPrompt);
}

export function readInbox(filename: string, c: Of<'inbox'>) {
  const key = c.key ?? warmupScope(undefined, c.envScope, c.session === undefined ? undefined : sessionKey(filename, c.session));
  const app = createApp(filename, false);
  try {
    return app.serialize(() => {
      const events = key === 'all' ? app.events.pending(null).filter(e => e.kind !== 'message') : app.events.pending(key);
      app.events.deliver(events.map(e => e.id));
      return { events: events.map(e => ({ id: e.id, from: e.fromKey, to: e.toKey, kind: e.kind, createdAt: e.createdAt,
        text: frame(e, localTime(e.createdAt)) })) };
    });
  } finally { app.close(); }
}

export function listEvents(filename: string, c: Of<'event_list'>) {
  const app = createApp(filename, true);
  try { const { name: _, ...filter } = c; return app.events.browse(filter); } finally { app.close(); }
}

export async function sendMessage(filename: string, c: Of<'message_send'>, transports: EventTransports = {},
  proc = '/proc'): Promise<{ message: number; delivered: boolean }> {
  const text = inputText(c.body);
  const from = callerKey(filename, c);
  if (from === undefined) throw new InputError('The calling session key could not be resolved');
  const app = createApp(filename, false);
  try {
    const id = sendParentMessage(app, { from, to: c.key, message: text });
    const acked = await deliverPending(app, c.key, c.runtime ?? c.session?.runtime, transports, proc);
    return { message: id, delivered: acked.includes(id) };
  } finally { app.close(); }
}
