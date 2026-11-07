import { InputError } from '../../shared/errors.js';
import type { ArchiveAgent, ArchiveCounts, ArchiveFolder, ArchiveRead, ArchiveSession, ArchiveStore, KeyLookup, KeySource, TranscriptFiles, TranscriptReader } from './ports.js';
export type { ArchiveAgent, ArchiveCounts, ArchiveEntry, ArchiveFilter, ArchiveFolder, ArchiveHit, ArchiveKeys, ArchiveMessage, ArchiveOrigin, ArchiveRead, ArchiveRole, ArchiveSession, ArchiveSessionHits, KeyLookup, KeySource, TranscriptFiles, TranscriptReader } from './ports.js';
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
export function createArchive(store: ArchiveStore, keys: KeyLookup, clock: () => string) {
  return {
    offset: (agent: ArchiveAgent, nativeId: string): number => store.session(agent, nativeId)?.bytesRead ?? 0,
    session: (agent: ArchiveAgent, nativeId: string): ArchiveSession | undefined => store.session(agent, nativeId),
    counts: (): ArchiveCounts => store.transaction(() => store.counts()),
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
