import type { Scope } from '../../shared/scope.js';
import { scopeValue } from '../../shared/scope.js';
import { InputError } from '../../shared/errors.js';
import { entryValue, utc } from './model.js';
import type { Entry, EventType } from './model.js';
import type { JournalStore } from './ports.js';
export { createNotes } from './notes.js';
export type { Entry, EventType } from './model.js';

export function publishedArtifacts(store: JournalStore): Set<string> {
  const result = new Set<string>();
  for (const raw of store.entries()) for (const path of entryValue(raw).artifacts ?? []) result.add(path);
  return result;
}

export function createJournal(store: JournalStore, resolve: (scope: Scope) => void,
  contains: (filter: Scope, scope: Scope) => boolean, clock: () => string) {
  return {
    published: () => publishedArtifacts(store),
    record(scope: Scope, text: string, type: EventType = 'note', artifacts?: string[]): Entry {
      const entry = entryValue({ at: clock(), scope, event_type: type, text, ...(artifacts?.length ? { artifacts } : {}) });
      resolve(entry.scope);
      return entry;
    },
    append(entry: Entry) { const valid = entryValue(entry); resolve(valid.scope); return store.append(valid); },
    read(filter: Scope | 'all', options: { from?: string; to?: string; type?: EventType; limit?: number } = {}): Entry[] {
      if (filter !== 'all') resolve(scopeValue(filter));
      const from = options.from === undefined ? -Infinity : utc(options.from);
      const to = options.to === undefined ? Infinity : utc(options.to);
      if (from > to || (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1))
        || (options.type !== undefined && !['note', 'request_created', 'status_changed'].includes(options.type))) {
        throw new InputError('Invalid history filters');
      }
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
