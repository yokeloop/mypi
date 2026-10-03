import { InputError } from './errors.js';
export type Scope = { type: 'global' } | { type: 'org' | 'project' | 'request'; key: string };
export function scopeValue(value: unknown): Scope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Invalid scope');
  const x = value as Record<string, unknown>;
  const keys = Object.keys(x).sort().join(',');
  if (x['type'] === 'global' && keys === 'type') return { type: 'global' };
  if (keys !== 'key,type' || typeof x['key'] !== 'string') throw new InputError('Invalid scope fields');
  const type = x['type'], key = x['key'];
  if ((type === 'org' && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(key))
    || (type === 'project' && /^[A-Z]+$/.test(key) && key !== 'REQ')
    || (type === 'request' && /^[A-Z]+-[1-9][0-9]*$/.test(key))) return { type, key };
  throw new InputError('Invalid scope key/type');
}
export function sameScope(a: Scope, b: Scope): boolean {
  return a.type === b.type && (a.type === 'global' || (b.type !== 'global' && a.key === b.key));
}
