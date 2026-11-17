import type { createApp } from './create-app.js';
import type { SessionHint } from './session-input.js';
import type { Agent, RegistryRecord, SessionRow } from '../modules/sessions/public.js';
import { validSlug } from '../modules/projects/public.js';
import { InputError } from '../shared/errors.js';

type Sessions = ReturnType<ReturnType<typeof createApp>['sessions']>;

export const PERMISSION_MODES = ['manual', 'acceptEdits', 'auto', 'bypassPermissions', 'dontAsk', 'plan'] as const;

export type OpenKey = { kind: 'project'; code: string } | { kind: 'task'; code: string; number: number }
  | { kind: 'identity'; org: string; slug: string; number?: number } | { kind: 'org'; slug: string };

const noProject = () => new InputError('REQ tasks have no project; /open opens sessions of registered projects');

export function parseOpenKey(text: string): OpenKey {
  if (text === 'global') throw new InputError('global is the main chat, started by hand; /open opens organization (tb-ff), project (MP) and task (MP-12) sessions');
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
  if (text === 'all') throw new InputError('all is reserved for /inbox all; /open opens organization (tb-ff), project (MP) and task (MP-12) sessions');
  if (validSlug(text)) return { kind: 'org', slug: text };
  throw new InputError('Invalid key: ' + text + '; use an organization slug (tb-ff), a project code (MP), CODE-N (MP-12), org/project or org/project#N');
}

export function agentName(key: string, kind: OpenKey['kind']): string {
  return kind === 'org' ? 'org-' + key : key.toLowerCase();
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

export type OpenRequest = { chosen: Agent; agent?: Agent; new?: boolean; target?: string };

export function openTarget(rows: SessionRow[], key: string, device: string, target: string, agent?: Agent): SessionRow {
  const row = rows.find(r => r.nativeId === target);
  if (row === undefined) throw new InputError('Unknown session ' + target + ' of ' + key + '; mypi sessions lists the sessions of each key');
  if (row.device !== device) {
    throw new InputError('Session ' + target + ' of ' + key + ' is on ' + row.device + ', not on ' + device + '; a session of another device cannot be opened here');
  }
  if (agent !== undefined && agent !== row.agent) throw new InputError('Session ' + target + ' is a ' + row.agent + ' session; --agent ' + agent + ' does not match it');
  return row;
}

export function decideOpen(found: { rows: SessionRow[]; records: RegistryRecord[] }, key: string, device: string, request: OpenRequest): OpenDecision {
  const liveOf = (row: SessionRow) => found.records.find(r => r.agent === row.agent && r.nativeId === row.nativeId);
  if (request.target !== undefined) {
    const row = openTarget(found.rows, key, device, request.target, request.agent);
    const live = liveOf(row);
    return live ? { action: 'focus', agent: live.agent, live } : { action: 'resume', agent: row.agent, nativeId: row.nativeId };
  }
  if (request.new) return { action: 'start', agent: request.chosen };
  const own = found.rows.filter(r => r.device === device && (request.agent === undefined || r.agent === request.agent));
  for (const row of own) {
    const live = liveOf(row);
    if (live) return { action: 'focus', agent: live.agent, live };
  }
  const row = own[0];
  if (row) return { action: 'resume', agent: row.agent, nativeId: row.nativeId };
  return { action: 'start', agent: request.chosen };
}

export function herdrName(base: string, agent: Agent, held: ReadonlySet<string>): string {
  if (!held.has(base)) return base;
  for (let n = 1; ; n++) {
    const suffix = '-' + agent + (n === 1 ? '' : '-' + n);
    const name = base.slice(0, 32 - suffix.length) + suffix;
    if (!held.has(name)) return name;
  }
}

export function heldNames(records: RegistryRecord[]): Set<string> {
  return new Set(records.map(r => r.herdrName ?? agentName(r.key, /^[A-Z]/.test(r.key) || r.key === 'global' ? 'project' : 'org')));
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
  try {
    const records = sessions.lookup(key).records;
    const own = records.find(r => r.agent === hint.agent && r.nativeId === hint.nativeId) ?? records.find(r => r.pid === hint.pid);
    return own?.permissionMode ?? null;
  } catch { return null; }
}
