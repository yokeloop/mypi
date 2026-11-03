import type { Rec } from './envelope.js';

export type Screen = 'projects' | 'tasks' | 'events' | 'journal';

export const FILTERS: Readonly<Record<Screen, readonly string[]>> = {
  projects: ['org', 'q'],
  tasks: ['project', 'status', 'q'],
  events: ['to', 'from', 'kind', 'delivered', 'q'],
  journal: ['scope', 'type', 'from', 'to', 'q'],
};

const DATE = /^\d{4}-\d\d-\d\d$/;

export function filtersOf(screen: Screen, search: URLSearchParams): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const key of FILTERS[screen]) {
    const value = search.get(key)?.trim();
    if (value) filters[key] = value;
  }
  return filters;
}

export function withFilter(search: URLSearchParams, key: string, value: string | null): URLSearchParams {
  const next = new URLSearchParams(search);
  if (value === null || value.trim() === '') next.delete(key);
  else next.set(key, value);
  return next;
}

function apiValue(screen: Screen, key: string, value: string): string | null {
  if (screen === 'projects' && key === 'q') return null;
  if (screen === 'events' && key === 'delivered') return value === 'true' || value === 'false' ? value : null;
  if (screen === 'journal' && (key === 'from' || key === 'to')) {
    if (!DATE.test(value)) return null;
    return value + (key === 'from' ? 'T00:00:00Z' : 'T23:59:59Z');
  }
  return value;
}

export function apiPath(screen: Screen, filters: Record<string, string>, cursor?: string): string {
  const params = new URLSearchParams();
  for (const key of FILTERS[screen]) {
    const value = filters[key];
    if (value === undefined) continue;
    const sent = apiValue(screen, key, value);
    if (sent !== null) params.set(key, sent);
  }
  if (cursor !== undefined) params.set('cursor', cursor);
  const query = params.toString();
  return '/v1/' + screen + (query ? '?' + query : '');
}

export function filterProjects(items: Rec[], q: string | undefined): Rec[] {
  if (!q) return items;
  const needle = q.toLowerCase();
  return items.filter(item => [item.code, item.identity].some(v => typeof v === 'string' && v.toLowerCase().includes(needle)));
}
