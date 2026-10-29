import type { createApp } from './create-app.js';
import type { SessionHint } from './session-input.js';
import type { Agent, RegistryRecord, SessionRow } from '../modules/sessions/public.js';
import { InputError } from '../shared/errors.js';

type Sessions = ReturnType<ReturnType<typeof createApp>['sessions']>;

export const PERMISSION_MODES = ['manual', 'acceptEdits', 'auto', 'bypassPermissions', 'dontAsk', 'plan'] as const;

export type OpenKey = { kind: 'project'; code: string } | { kind: 'task'; code: string; number: number }
  | { kind: 'identity'; org: string; slug: string; number?: number };

const noProject = () => new InputError('REQ tasks have no project; /open opens sessions of registered projects');

export function parseOpenKey(text: string): OpenKey {
  if (text === 'global') throw new InputError('global is the main chat, started by hand; /open opens project (MP) and task (MP-12) sessions');
  if (/^[A-Z]+$/.test(text)) {
    if (text === 'REQ') throw noProject();
    return { kind: 'project', code: text };
  }
  const task = /^([A-Z]+)-([1-9][0-9]*)$/.exec(text);
  if (task) {
    if (task[1] === 'REQ') throw noProject();
    return { kind: 'task', code: task[1]!, number: Number(task[2]) };
  }
  const identity = /^([a-z0-9]+(?:[._-][a-z0-9]+)*)\/([a-z0-9]+(?:[._-][a-z0-9]+)*)(?:#([1-9][0-9]*))?$/.exec(text);
  if (identity) return { kind: 'identity', org: identity[1]!, slug: identity[2]!, ...(identity[3] === undefined ? {} : { number: Number(identity[3]) }) };
  throw new InputError('Invalid key: ' + text + '; use a project code (MP), CODE-N (MP-12), org/project or org/project#N');
}

export function defaultAgent(settings: string | undefined): Agent {
  if (settings === undefined) return 'claude';
  let value: unknown;
  try { value = JSON.parse(settings); } catch { throw new InputError('home/settings.json is not valid JSON'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InputError('home/settings.json is not valid JSON');
  const agent = (value as Record<string, unknown>)['defaultAgent'];
  if (agent === undefined) return 'claude';
  if (agent === 'claude' || agent === 'pi') return agent;
  throw new InputError('defaultAgent in home/settings.json must be claude or pi');
}

export type OpenDecision = { action: 'focus'; agent: Agent; live: RegistryRecord }
  | { action: 'resume'; agent: Agent; nativeId: string } | { action: 'start'; agent: Agent };

export function decideOpen(found: { row: SessionRow | undefined; live: RegistryRecord | undefined }, chosen: Agent): OpenDecision {
  if (found.live) return { action: 'focus', agent: found.live.agent, live: found.live };
  if (found.row) return { action: 'resume', agent: found.row.agent, nativeId: found.row.nativeId };
  return { action: 'start', agent: chosen };
}

export function launchArgs(decision: Exclude<OpenDecision, { action: 'focus' }>, key: string, mode: string | null, uuid: string): string[] {
  const session = decision.action === 'start' ? ['--session-id', uuid, '--name', key]
    : [decision.agent === 'pi' ? '--session-id' : '--resume', decision.nativeId];
  if (decision.agent === 'pi') return session;
  return [...session, ...(mode === null ? [] : ['--permission-mode', mode]), '--settings', '{"crossSessionInbound":"accept"}'];
}

export function callerMode(sessions: Sessions, hint: SessionHint | undefined): string | null | undefined {
  if (hint === undefined) return undefined;
  const key = sessions.resolve(hint);
  if (key === undefined) return null;
  try { return sessions.lookup(key).live?.permissionMode ?? null; } catch { return null; }
}
