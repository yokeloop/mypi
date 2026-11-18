import { existsSync, statSync } from 'node:fs';
import { archivePath, createApp, createArchiveApp } from './create-app.js';
import { emptyCounts, forgetFilter } from '../modules/archive/public.js';
import type { ArchiveAgent, ArchiveCounts, ArchiveEntry, ArchiveKeys, createArchive } from '../modules/archive/public.js';
import { InputError } from '../shared/errors.js';

type Agent = ArchiveAgent;
type Archive = ReturnType<typeof createArchive>;
export type ArchiveRecordRead = { entries: ArchiveEntry[]; name: string | null; cwd: string | null; parentNativeId: string | null };
export type ArchiveOperations = {
  archive_offset: { input: { agent: Agent; nativeId: string }; output: { offset: number } };
  archive_record: { input: { agent: Agent; nativeId: string; path: string; expectedOffset: number; newOffset: number; read: ArchiveRecordRead };
    output: { archive: string; inserted: number; skipped: number; bytesRead: number; key: string | null } };
  archive_status: { input: Record<string, never>; output: { path: string; exists: boolean; bytes: number } & ArchiveCounts };
  archive_search: { input: { q?: string; scope?: string; agent?: Agent; from?: string; to?: string; includePeer?: boolean; limit?: number };
    output: ReturnType<Archive['search']> };
  archive_show: { input: { id?: number; before?: number; after?: number; session?: string; agent?: Agent; offset?: number; limit?: number; includePeer?: boolean };
    output: ReturnType<Archive['show']> };
  archive_forget: { input: { session?: string; key?: string; before?: string }; output: { archive: string; sessions: number; messages: number } };
};
export type ArchiveOperationName = keyof ArchiveOperations;
export type ArchiveOperationInput<K extends ArchiveOperationName> = ArchiveOperations[K]['input'];
export type ArchiveOperationOutput<K extends ArchiveOperationName> = ArchiveOperations[K]['output'];
export type ArchiveRunner = { remote: boolean; chunkBytes: number | null;
  run<K extends ArchiveOperationName>(name: K, input: ArchiveOperationInput<K>): Promise<ArchiveOperationOutput<K>> };
export const ARCHIVE_CHUNK_BYTES = 512 * 1024;

function openForReading(filename: string) {
  const path = archivePath(filename);
  if (!existsSync(path)) throw new InputError('No conversation archive at ' + path + '; run mypi archive import first');
  return createArchiveApp(filename, true);
}

export function archiveScope(filename: string, key: string): ArchiveKeys {
  const app = createApp(filename, true);
  try {
    if (!app.archiveKeys.registered(key))
      throw new InputError('Unknown archive scope: ' + key + '; use global, an organization slug, a project code or a task key');
    if (key === 'global' || /^[A-Z]+-[1-9][0-9]*$/.test(key)) return { exact: [key], projects: [] };
    if (/^[A-Z]+$/.test(key)) return { exact: [], projects: [key] };
    return { exact: [key], projects: app.projects.list(key).map(p => p.code) };
  } finally { app.close(); }
}

export const archiveOperations = {
  archive_offset: (t, i) => {
    if (!existsSync(archivePath(t.filename))) {
      createApp(t.filename, true).close();
      return { offset: 0 };
    }
    const { archive, close } = createArchiveApp(t.filename, true);
    try {
      return { offset: archive.offset(i.agent, i.nativeId) };
    } finally { close(); }
  },
  archive_record: (t, i) => {
    const { path, archive, close } = createArchiveApp(t.filename, false);
    try {
      const r = archive.record({ agent: i.agent, nativeId: i.nativeId, path: i.path, read: { ...i.read, offset: i.newOffset }, expectedOffset: i.expectedOffset });
      return { archive: path, inserted: r.inserted, skipped: r.skipped, bytesRead: r.bytesRead, key: r.key };
    } finally { close(); }
  },
  archive_status: t => {
    const path = archivePath(t.filename);
    if (!existsSync(path)) return { path, exists: false, bytes: 0, ...emptyCounts() };
    const { archive, close } = createArchiveApp(t.filename, true);
    try {
      return { path, exists: true, bytes: statSync(path).size, ...archive.counts() };
    } finally { close(); }
  },
  archive_search: (t, i) => {
    const { archive, close } = openForReading(t.filename);
    try {
      const { scope, ...input } = i;
      const keys = scope === undefined ? null : archiveScope(t.filename, scope);
      return archive.search({ ...input, keys });
    } finally { close(); }
  },
  archive_show: (t, i) => {
    const { archive, close } = openForReading(t.filename);
    try {
      return archive.show(i);
    } finally { close(); }
  },
  archive_forget: (t, i) => {
    forgetFilter(i);
    const path = archivePath(t.filename);
    if (!existsSync(path)) return { archive: path, sessions: 0, messages: 0 };
    const { archive, close } = createArchiveApp(t.filename, false);
    try {
      return { archive: path, ...archive.forget(i) };
    } finally { close(); }
  },
} satisfies { [K in ArchiveOperationName]: (t: { filename: string }, i: ArchiveOperationInput<K>) => ArchiveOperationOutput<K> };

export function runArchiveOperation<K extends ArchiveOperationName>(t: { filename: string }, name: K, input: ArchiveOperationInput<K>): ArchiveOperationOutput<K> {
  return (archiveOperations[name] as (t: { filename: string }, i: ArchiveOperationInput<K>) => ArchiveOperationOutput<K>)(t, input);
}

export function localArchiveRunner(filename: string): ArchiveRunner {
  return { remote: false, chunkBytes: null, run: async (name, input) => runArchiveOperation({ filename }, name, input) };
}
