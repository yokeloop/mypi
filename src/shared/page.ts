import { InputError } from './errors.js';

export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 200;
export type Page<T> = { items: T[]; next: number | null };

export function pageLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_LIMIT_MAX) throw new InputError('Invalid page limit');
  return limit;
}

export function matchesQuery(q: string | undefined, ...texts: (string | null)[]): boolean {
  if (q === undefined || q === '') return true;
  const needle = q.toLowerCase();
  return texts.some(t => t !== null && t.toLowerCase().includes(needle));
}

export function takePage<T>(rows: Iterable<T>, limit: number, cursor: (row: T) => number): Page<T> {
  pageLimit(limit);
  const items: T[] = [];
  for (const row of rows) {
    items.push(row);
    if (items.length > limit) break;
  }
  if (items.length > limit) return { items: items.slice(0, limit), next: cursor(items[limit - 1]!) };
  return { items, next: null };
}
