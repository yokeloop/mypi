import { InputError } from '../../shared/errors.js';
import type { ArchiveAgent, ArchiveCounts, ArchiveFilter, ArchiveFolder, ArchiveKeys, ArchiveRead, ArchiveSession, ArchiveStore, KeyLookup, KeySource, TranscriptFiles, TranscriptReader } from './ports.js';
export type { ArchiveAgent, ArchiveCounts, ArchiveEntry, ArchiveFilter, ArchiveForget, ArchiveFolder, ArchiveHit, ArchiveKeys, ArchiveMessage, ArchiveOrigin, ArchiveRead, ArchiveRole, ArchiveSession, ArchiveSessionHits, KeyLookup, KeySource, TranscriptFiles, TranscriptReader } from './ports.js';
export function claudeFolderName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}
export function piFolderName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}
export function nativeIdOf(agent: ArchiveAgent, path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.jsonl$/, '');
  const cut = name.indexOf('_');
  return agent === 'pi' && cut >= 0 ? name.slice(cut + 1) : name;
}
export function ftsQuery(q: string): string {
  const parts: string[] = [];
  for (const token of q.split(/\s+/)) {
    const prefix = token.length > 1 && token.endsWith('*');
    const word = prefix ? token.slice(0, -1) : token;
    if (!/[\p{L}\p{N}]/u.test(word)) continue;
    parts.push('"' + word.replaceAll('"', '""') + '"' + (prefix ? '*' : ''));
  }
  if (parts.length === 0) throw new InputError('Search query has no words');
  return parts.join(' ');
}
export function archiveInstant(value: string, end: boolean): string {
  const iso = /^\d{4}-\d\d-\d\d$/.test(value) ? value + (end ? 'T23:59:59.999Z' : 'T00:00:00.000Z')
    : /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ? value : undefined;
  const time = iso === undefined ? NaN : Date.parse(iso);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace('.000Z', 'Z') !== iso!.replace('.000Z', 'Z'))
    throw new InputError('Invalid UTC time or date: ' + value);
  return new Date(time).toISOString();
}
export function emptyCounts(): ArchiveCounts {
  return { sessions: { claude: 0, pi: 0 }, messages: { claude: 0, pi: 0 }, boundSessions: 0, unboundSessions: 0, keys: 0,
    keySources: { sessions: 0, name: 0 } };
}
export function bindKey(agent: ArchiveAgent, nativeId: string, name: string | null, lookup: KeyLookup): { key: string; keySource: KeySource } | null {
  const key = lookup.byNative(agent, nativeId);
  if (key !== undefined) return { key, keySource: 'sessions' };
  if (name !== null && lookup.registered(name)) return { key: name, keySource: 'name' };
  return null;
}
function bounded(value: number | undefined, name: string, fallback: number, min: number, max: number, unit = ''): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min) throw new InputError('Invalid ' + name);
  if (value > max) throw new InputError(name + ' is at most ' + max + unit);
  return value;
}
function archiveAgent(agent: string | undefined): ArchiveAgent | undefined {
  if (agent !== undefined && agent !== 'claude' && agent !== 'pi') throw new InputError('agent must be claude or pi');
  return agent;
}
export function createArchive(store: ArchiveStore, keys: KeyLookup, clock: () => string) {
  const header = (agent: ArchiveAgent, nativeId: string) => {
    const row = store.session(agent, nativeId);
    return { agent, session: nativeId, key: row?.key ?? null, firstAt: row?.firstAt ?? null, lastAt: row?.lastAt ?? null };
  };
  return {
    offset: (agent: ArchiveAgent, nativeId: string): number => store.session(agent, nativeId)?.bytesRead ?? 0,
    session: (agent: ArchiveAgent, nativeId: string): ArchiveSession | undefined => store.session(agent, nativeId),
    counts: (): ArchiveCounts => store.transaction(() => store.counts()),
    search(input: { q?: string; keys: ArchiveKeys | null; agent?: string; from?: string; to?: string; includePeer?: boolean; limit?: number }) {
      const agent = archiveAgent(input.agent);
      const from = input.from === undefined ? undefined : archiveInstant(input.from, false);
      const to = input.to === undefined ? undefined : archiveInstant(input.to, true);
      if (from !== undefined && to !== undefined && from > to) throw new InputError('from is after to');
      const filter: ArchiveFilter = { keys: input.keys, ...(agent === undefined ? {} : { agent }), ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }), includePeer: input.includePeer === true };
      if (input.q !== undefined) {
        const match = ftsQuery(input.q), limit = bounded(input.limit, 'limit', 10, 1, 50, ' hits');
        return store.transaction(() => ({ hits: store.search(match, filter, limit) }));
      }
      const limit = bounded(input.limit, 'limit', 50, 1, 200, ' sessions');
      return store.transaction(() => ({ sessions: store.sessionList(filter, limit) }));
    },
    show(input: { id?: number; before?: number; after?: number; session?: string; agent?: string; offset?: number; limit?: number; includePeer?: boolean }) {
      if ((input.id === undefined) === (input.session === undefined)) throw new InputError('Use archive_show with exactly one of id or session');
      const includePeer = input.includePeer === true;
      if (input.id !== undefined) {
        for (const field of ['agent', 'offset', 'limit'] as const) if (input[field] !== undefined) throw new InputError(field + ' is not allowed with id');
        const id = input.id;
        if (!Number.isSafeInteger(id) || id < 1) throw new InputError('Invalid id');
        const before = bounded(input.before, 'before', 3, 0, 20), after = bounded(input.after, 'after', 3, 0, 20);
        return store.transaction(() => {
          const anchor = store.message(id);
          if (!anchor) throw new InputError('Unknown archive message: ' + id);
          const near = store.around(anchor, before, after, includePeer);
          const { agent, session, ...message } = anchor;
          return { session: header(agent, session), anchor: id, messages: [...near.before, message, ...near.after] };
        });
      }
      for (const field of ['before', 'after'] as const) if (input[field] !== undefined) throw new InputError(field + ' is not allowed with session');
      const session = input.session!, agent = archiveAgent(input.agent);
      const offset = bounded(input.offset, 'offset', 0, 0, Number.MAX_SAFE_INTEGER), limit = bounded(input.limit, 'limit', 20, 1, 50);
      return store.transaction(() => {
        const agents = store.agentsOf(session).filter(a => agent === undefined || a === agent);
        if (agents.length === 0) throw new InputError('Unknown archive session: ' + session);
        if (agents.length > 1) throw new InputError('Session ' + session + ' exists for claude and pi; pass agent');
        const { messages, total } = store.page(agents[0]!, session, offset, limit, includePeer);
        return { session: header(agents[0]!, session), offset, total, next: offset + messages.length < total ? offset + messages.length : null, messages };
      });
    },
    record(input: { agent: ArchiveAgent; nativeId: string; path: string; read: ArchiveRead }):
      { inserted: number; skipped: number; key: string | null; keySource: KeySource | null; bytesRead: number } {
      const { agent, nativeId, path, read } = input;
      if (typeof nativeId !== 'string' || nativeId === '' || nativeId.length > 256
        || /[\u0000-\u001f\u007f]/.test(nativeId)) throw new InputError('Invalid native session id');
      if (typeof path !== 'string' || path === '' || path.includes('\0')) throw new InputError('Invalid transcript path');
      return store.transaction(() => {
        const existing = store.session(agent, nativeId);
        const bound = bindKey(agent, nativeId, read.name, keys);
        const key = bound?.key ?? existing?.key ?? null;
        const keySource = bound?.keySource ?? existing?.keySource ?? null;
        const times = [existing?.firstAt, existing?.lastAt, ...read.entries.map(e => e.at)].filter((at): at is string => typeof at === 'string').sort();
        store.saveSession({
          agent, nativeId, path, cwd: read.cwd ?? existing?.cwd ?? null, key, keySource,
          parentNativeId: read.parentNativeId ?? existing?.parentNativeId ?? null,
          firstAt: times[0] ?? null, lastAt: times[times.length - 1] ?? null, bytesRead: read.offset, updatedAt: clock(),
        });
        const inserted = store.insertMessages(agent, nativeId, read.entries);
        return { inserted, skipped: read.entries.length - inserted, key, keySource, bytesRead: read.offset };
      });
    },
  };
}
export function createImport(archive: ReturnType<typeof createArchive>, readers: Record<ArchiveAgent, TranscriptReader>, files: TranscriptFiles) {
  const file = (agent: ArchiveAgent, path: string, nativeId: string = nativeIdOf(agent, path)):
    { agent: ArchiveAgent; nativeId: string; path: string; inserted: number; skipped: number; bytesRead: number; key: string | null } => {
    const read = readers[agent](path, archive.offset(agent, nativeId));
    const { inserted, skipped, bytesRead, key } = archive.record({ agent, nativeId, path, read });
    return { agent, nativeId, path, inserted, skipped, bytesRead, key };
  };
  return {
    file,
    folders(list: ArchiveFolder[]) {
      const total = { files: 0, inserted: 0, skipped: 0 };
      const failed: { agent: ArchiveAgent; path: string; error: string }[] = [];
      const dirs: { agent: ArchiveAgent; path: string; files: number; inserted: number; skipped: number }[] = [];
      for (const folder of list) {
        const dir = { agent: folder.agent, path: folder.path, files: 0, inserted: 0, skipped: 0 };
        for (const path of files.list(folder.path)) {
          try {
            const result = file(folder.agent, path);
            dir.files++; dir.inserted += result.inserted; dir.skipped += result.skipped;
          } catch (error) {
            failed.push({ agent: folder.agent, path, error: error instanceof Error ? error.message : String(error) });
          }
        }
        total.files += dir.files; total.inserted += dir.inserted; total.skipped += dir.skipped;
        dirs.push(dir);
      }
      return { ...total, failed, dirs };
    },
  };
}
