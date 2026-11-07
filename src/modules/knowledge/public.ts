import type { Scope } from '../../shared/scope.js';
import { scopeValue } from '../../shared/scope.js';
import { InputError } from '../../shared/errors.js';
import { entryValue, utc, EVENT_TYPES } from './model.js';
import type { ArtifactRef, Entry, EventType } from './model.js';
import type { JournalBrowseStore, JournalStore } from './ports.js';
export type { JournalSummaryStore } from './ports.js';
import { matchesQuery, takePage } from '../../shared/page.js';
import type { Page } from '../../shared/page.js';
export { createNotes } from './notes.js';
export type { ArtifactRef, Entry, EventType } from './model.js';
export { EVENT_TYPES } from './model.js';
export { artifactRefPath } from './model.js';
export { sqliteJournalStore } from './adapters/sqlite-journal.js';
export type { FileFingerprint, JournalImport } from './adapters/sqlite-journal.js';

export function frozenArtifacts(store: JournalStore): Set<string> {
  const result = new Set<string>();
  for (const raw of store.entries()) for (const ref of entryValue(raw).artifacts ?? []) if (typeof ref === 'string') result.add(ref);
  return result;
}

function historyFilter(options: { from?: string; to?: string; type?: EventType; limit?: number }): { from: number; to: number } {
  const from = options.from === undefined ? -Infinity : utc(options.from);
  const to = options.to === undefined ? Infinity : utc(options.to);
  if (from > to || (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1))
    || (options.type !== undefined && !(EVENT_TYPES as readonly string[]).includes(options.type))) {
    throw new InputError('Invalid history filters');
  }
  return { from, to };
}

export function createJournalBrowser(store: JournalBrowseStore, resolve: (scope: Scope) => void,
  contains: (filter: Scope, scope: Scope) => boolean) {
  return {
    page(filter: Scope | 'all', options: { from?: string; to?: string; type?: EventType; q?: string; before?: number; limit: number }): Page<{ id: number; entry: Entry }> {
      const { from, to } = historyFilter(options);
      if (filter !== 'all') resolve(scopeValue(filter));
      function* rows() {
        for (const { id, raw } of store.recent(options.before, options.from?.slice(0, 7), options.to?.slice(0, 7))) {
          const entry = entryValue(raw);
          resolve(entry.scope);
          const at = utc(entry.at);
          if (at < from || at > to || (options.type && entry.event_type !== options.type)
            || (filter !== 'all' && !contains(filter, entry.scope)) || !matchesQuery(options.q, entry.text)) continue;
          yield { id, entry };
        }
      }
      return takePage(rows(), options.limit, x => x.id);
    },
  };
}

export function createJournal(store: JournalStore, resolve: (scope: Scope) => void,
  contains: (filter: Scope, scope: Scope) => boolean, clock: () => string) {
  return {
    frozen: () => frozenArtifacts(store),
    record(scope: Scope, text: string, type: EventType = 'note', artifacts?: ArtifactRef[]): Entry {
      const entry = entryValue({ at: clock(), scope, event_type: type, text, ...(artifacts?.length ? { artifacts } : {}) });
      resolve(entry.scope);
      return entry;
    },
    append(entry: Entry) { const valid = entryValue(entry); resolve(valid.scope); return store.append(valid); },
    read(filter: Scope | 'all', options: { from?: string; to?: string; type?: EventType; limit?: number } = {}): Entry[] {
      if (filter !== 'all') resolve(scopeValue(filter));
      const { from, to } = historyFilter(options);
      const result: Entry[] = [];
      for (const raw of store.entries(options.from?.slice(0, 7), options.to?.slice(0, 7))) {
        const entry = entryValue(raw);
        resolve(entry.scope);
        const at = utc(entry.at);
        if (at < from || at > to || (options.type && entry.event_type !== options.type)
          || (filter !== 'all' && !contains(filter, entry.scope))) continue;
        result.push(entry);
        if (options.limit !== undefined && result.length > options.limit) {
          result.sort((a, b) => utc(a.at) - utc(b.at));
          result.shift();
        }
      }
      result.sort((a, b) => utc(a.at) - utc(b.at));
      return options.limit === undefined ? result : result.slice(-options.limit);
    },
  };
}
