import { readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { AppCommand } from './commands.js';
import { WAITING_NOTIFICATIONS } from './session-input.js';
import { callerIdentity, callerKey, sessionKey } from './sessions.js';
import { localTime, warmupScope } from './warmup.js';
import { deliverPending } from './delivery.js';
import type { EventTransports } from './delivery.js';
import type { SessionRunner } from './session-operations.js';
import { inputText } from './input-text.js';
import { InputError } from '../shared/errors.js';
import { claudeTurnPrompt } from '../infrastructure/transcript/claude-transcript.js';
import { claudeTurnActions } from '../infrastructure/transcript/claude-turn.js';
import type { TurnActionReader } from '../shared/turn-actions.js';
import { saveFolder, turnFindings, turnReason } from './turn-check.js';
import { frame, parentKey, parentSender, startedByParent } from '../modules/events/public.js';
import type { TurnPromptReader } from '../modules/events/public.js';

type Of<N extends AppCommand['name']> = Extract<AppCommand, { name: N }>;

export async function emitEvent(runner: SessionRunner, c: Of<'event_emit'>, transports: EventTransports = {},
  proc = '/proc', readPrompt: TurnPromptReader = claudeTurnPrompt): Promise<{ event: number | null; delivered: number[] }> {
  if (c.notification !== undefined && !(WAITING_NOTIFICATIONS as readonly string[]).includes(c.notification)) return { event: null, delivered: [] };
  const key = warmupScope(c.from, c.envScope, c.from === undefined && c.session !== undefined ? await sessionKey(runner, c.session, proc) : undefined);
  const hooked = c.from === undefined && c.session !== undefined;
  let to = c.to;
  if (hooked) {
    const prompt = c.transcript === undefined ? undefined : readPrompt(c.transcript);
    if (parentKey(key) === undefined || !startedByParent(prompt)) return { event: null, delivered: [] };
    to = parentSender(prompt!.text);
  }
  const result = await runner.run('event_create', { from: key, kind: c.kind, message: c.message, ...(to === undefined ? {} : { to }) });
  if (result.event === null) return { event: null, delivered: [] };
  return { event: result.event, delivered: await deliverPending(runner, result.to!, c.runtime ?? c.session?.runtime, transports, proc) };
}

export async function turnEnd(runner: SessionRunner, c: Of<'turn_end'>, home: string, transports: EventTransports = {}, proc = '/proc',
  readPrompt: TurnPromptReader = claudeTurnPrompt, readActions: TurnActionReader = claudeTurnActions
): Promise<{ event: number | null; delivered: number[]; reason: string | null }> {
  const session = { agent: 'claude' as const, nativeId: c.nativeId, pid: c.pid, ...(c.runtime === undefined ? {} : { runtime: c.runtime }) };
  let failure: unknown;
  if (!c.active && c.transcript !== undefined) {
    try {
      const actions = readActions(c.transcript);
      if (actions !== undefined) {
        const tmp = [...new Set(['/tmp', tmpdir(), c.scratchpad].filter(d => d !== undefined).map(d => resolve(d)))];
        const findings = turnFindings(actions, { home, tmp, ...(c.cwd === undefined ? {} : { cwd: c.cwd }),
          read: path => { try { return readFileSync(path, 'utf8'); } catch { return undefined; } },
          isDirectory: path => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true });
        if (findings !== null) {
          const key = warmupScope(undefined, c.envScope, await sessionKey(runner, session, proc));
          return { event: null, delivered: [], reason: turnReason(findings, await saveFolder(runner, home, key), home) };
        }
      }
    } catch (error) {
      failure = error;
    }
  }
  const result = await emitEvent(runner, { name: 'event_emit', kind: 'turn_end', message: c.message, session,
    ...(c.envScope === undefined ? {} : { envScope: c.envScope }),
    ...(c.transcript === undefined ? {} : { transcript: c.transcript }) }, transports, proc, readPrompt);
  if (failure !== undefined) throw failure;
  return { ...result, reason: null };
}

export function stopOutput(result: { event: number | null; delivered: number[]; reason: string | null }): string {
  return result.reason === null ? '' : JSON.stringify({ decision: 'block', reason: result.reason }) + '\n';
}

export async function readInbox(runner: SessionRunner, c: Of<'inbox'>, proc = '/proc') {
  const key = c.key ?? warmupScope(undefined, c.envScope, c.session === undefined ? undefined : await sessionKey(runner, c.session, proc));
  const { events } = await runner.run('inbox_take', { key, caller: c.session === undefined ? null : callerIdentity(c.session, proc) });
  return { events: events.map(e => ({ id: e.id, from: e.fromKey, to: e.toKey, kind: e.kind, createdAt: e.createdAt,
    text: frame(e, localTime(e.createdAt)) })) };
}

export async function sendMessage(runner: SessionRunner, c: Of<'message_send'>, transports: EventTransports = {},
  proc = '/proc'): Promise<{ message: number; delivered: boolean }> {
  const text = inputText(c.body);
  const from = await callerKey(runner, c);
  if (from === undefined) throw new InputError('The calling session key could not be resolved');
  const { id } = await runner.run('message_create', { from, to: c.key, message: text });
  const acked = await deliverPending(runner, c.key, c.runtime ?? c.session?.runtime, transports, proc);
  return { message: id, delivered: acked.includes(id) };
}
