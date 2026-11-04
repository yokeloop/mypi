import type { Rec } from './envelope.js';

export function text(record: Rec, key: string): string | null {
  const value = record[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function display(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function extraFields(record: Rec, known: readonly string[]): [string, string][] {
  return Object.entries(record).filter(([key]) => !known.includes(key)).map(([key, value]) => [key, display(value)]);
}
