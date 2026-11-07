import { InputError } from '../../shared/errors.js';
import type { ArchiveAgent, ArchiveRead, ArchiveSession, ArchiveStore, KeyLookup, KeySource } from './ports.js';
export type { ArchiveAgent, ArchiveEntry, ArchiveOrigin, ArchiveRead, ArchiveRole, ArchiveSession, KeyLookup, KeySource, TranscriptReader } from './ports.js';
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
