import type { Entry } from './model.js';
export interface JournalStore {
  append(entry: Entry): string;
  entries(fromMonth?: string, toMonth?: string): Iterable<unknown>;
}
