import type { Scope } from '../../shared/scope.js';
import { scopeValue } from '../../shared/scope.js';
import { InputError } from '../../shared/errors.js';

export type EventType = 'note' | 'request_created' | 'status_changed';
export interface Entry { at: string; scope: Scope; event_type: EventType; text: string; artifacts?: string[] }
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
export function entryValue(value: unknown): Entry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Invalid journal object');
  const x = value as Record<string, unknown>;
  if (Object.keys(x).some(k => !['at', 'scope', 'event_type', 'text', 'artifacts'].includes(k))
    || typeof x['at'] !== 'string' || typeof x['text'] !== 'string' || !x['text'].trim()) throw new InputError('Invalid journal fields/text');
  utc(x['at']);
  const scope = scopeValue(x['scope']);
  const type = x['event_type'];
  if (typeof type !== 'string' || !['note', 'request_created', 'status_changed'].includes(type)
    || (type !== 'note' && scope.type !== 'request')) throw new InputError('Invalid event type/scope');
  const entry: Entry = { at: x['at'], scope, event_type: type as EventType, text: x['text'] };
  if ('artifacts' in x) {
    if (!Array.isArray(x['artifacts']) || !x['artifacts'].length) throw new InputError('Invalid artifacts');
    for (const p of x['artifacts']) { if (typeof p !== 'string') throw new InputError('Invalid artifact'); artifactPath(p); }
    entry.artifacts = x['artifacts'] as string[];
  }
  return entry;
}
