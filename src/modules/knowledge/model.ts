import type { Scope } from '../../shared/scope.js';
import { scopeValue } from '../../shared/scope.js';
import { InputError } from '../../shared/errors.js';

export const EVENT_TYPES = ['note', 'task_created', 'status_changed', 'title_changed', 'worktree_created', 'session_opened', 'message_sent', 'clone_prepared'] as const;
export type EventType = typeof EVENT_TYPES[number];
const EVENT_SCOPES: Record<EventType, readonly Scope['type'][]> = {
  note: ['global', 'org', 'project', 'task'],
  task_created: ['task'],
  status_changed: ['task'],
  title_changed: ['task'],
  worktree_created: ['task'],
  session_opened: ['task', 'project', 'org'],
  message_sent: ['task', 'project', 'org'],
  clone_prepared: ['project'],
};
export type ArtifactRef = string | { path: string; commit: string };
export interface Entry { at: string; scope: Scope; event_type: EventType; text: string; artifacts?: ArtifactRef[] }
export function utc(value: string): number {
  const time = Date.parse(value);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(time)
    || new Date(time).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) throw new InputError('Invalid UTC time');
  return time;
}
export function artifactPath(path: string): void {
  if (!path || /[\\\x00-\x1f:]/.test(path) || path.split('/').some(x => !x || x === '..' || x === '.' || x === '.git')) {
    throw new InputError('Invalid artifact path');
  }
}
export function artifactRefPath(ref: ArtifactRef): string {
  return typeof ref === 'string' ? ref : ref.path;
}
function artifactRef(value: unknown): void {
  if (typeof value === 'string') return artifactPath(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Invalid artifact');
  const ref = value as Record<string, unknown>;
  if (Object.keys(ref).sort().join(',') !== 'commit,path' || typeof ref['path'] !== 'string' || typeof ref['commit'] !== 'string'
    || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref['commit'])) throw new InputError('Invalid artifact');
  artifactPath(ref['path']);
}
export function entryValue(value: unknown): Entry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Invalid journal object');
  const x = value as Record<string, unknown>;
  if (Object.keys(x).some(k => !['at', 'scope', 'event_type', 'text', 'artifacts'].includes(k))
    || typeof x['at'] !== 'string' || typeof x['text'] !== 'string' || !x['text'].trim()) throw new InputError('Invalid journal fields/text');
  utc(x['at']);
  const scope = scopeValue(x['scope']);
  const type = x['event_type'];
  if (typeof type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(type)
    || !EVENT_SCOPES[type as EventType].includes(scope.type)) throw new InputError('Invalid event type/scope');
  const entry: Entry = { at: x['at'], scope, event_type: type as EventType, text: x['text'] };
  if ('artifacts' in x) {
    if (!Array.isArray(x['artifacts']) || !x['artifacts'].length) throw new InputError('Invalid artifacts');
    for (const p of x['artifacts']) artifactRef(p);
    entry.artifacts = x['artifacts'] as ArtifactRef[];
  }
  return entry;
}
