import type { Entry } from './model.js';
import type { Scope } from '../../shared/scope.js';
export interface JournalStore {
  append(entry: Entry): string;
  entries(fromMonth?: string, toMonth?: string): Iterable<unknown>;
}
export interface JournalBrowseStore {
  recent(before: number | undefined, fromMonth?: string, toMonth?: string): Iterable<{ id: number; raw: unknown }>;
}
export interface JournalSummaryStore {
  stats(project: string, tasks: readonly string[]): { count: number; lastAt: string | null };
  last(scope: Scope, limit: number): Entry[];
}
