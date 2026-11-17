import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppCommand } from './commands.js';
import { engineRoot } from './create-app.js';
import { runArchiveOperation } from './archive-operations.js';
import type { ArchiveOperationOutput, ArchiveRunner } from './archive-operations.js';
import { claudeFolderName, nativeIdOf, piFolderName } from '../modules/archive/public.js';
import type { ArchiveAgent, ArchiveEntry, ArchiveFolder } from '../modules/archive/public.js';
import { claudeArchive } from '../infrastructure/transcript/claude-archive.js';
import { piArchive } from '../infrastructure/transcript/pi-archive.js';
import { listTranscripts } from '../infrastructure/transcript/transcript-files.js';
import { InputError } from '../shared/errors.js';

export { archiveScope } from './archive-operations.js';

type Of<N extends AppCommand['name']> = Extract<AppCommand, { name: N }>;

export function engineFolders(home: string, cwd: string): ArchiveFolder[] {
  return [{ agent: 'claude', path: join(home, '.claude', 'projects', claudeFolderName(cwd)) },
    { agent: 'pi', path: join(home, '.pi', 'agent', 'sessions', piFolderName(cwd)) }];
}

function fitEntry(entry: ArchiveEntry, budget: number): ArchiveEntry {
  const size = Buffer.byteLength(JSON.stringify(entry));
  if (size <= budget) return entry;
  const bytes = Buffer.from(entry.text);
  let keep = bytes.length - (size - budget) - 64;
  for (;;) {
    const kept = bytes.subarray(0, Math.max(keep, 0)).toString('utf8').replace(/\uFFFD$/, '');
    const text = kept + '\n[mypi: truncated ' + (bytes.length - Buffer.byteLength(kept)) + ' bytes]';
    const over = Buffer.byteLength(JSON.stringify({ ...entry, text })) - budget;
    if (over <= 0 || keep <= 0) return { ...entry, text };
    keep -= over;
  }
}

function chunks(entries: ArchiveEntry[], budget: number | null): ArchiveEntry[][] {
  if (budget === null) return [entries];
  const list: ArchiveEntry[][] = [[]];
  let size = 0;
  for (const entry of entries.map(e => fitEntry(e, budget))) {
    const bytes = Buffer.byteLength(JSON.stringify(entry));
    if (list.at(-1)!.length > 0 && size + bytes > budget) { list.push([]); size = 0; }
    list.at(-1)!.push(entry);
    size += bytes;
  }
  return list;
}

async function recordFile(runner: ArchiveRunner, agent: ArchiveAgent, path: string, nativeId = nativeIdOf(agent, path)) {
  const { offset } = await runner.run('archive_offset', { agent, nativeId });
  const read = (agent === 'claude' ? claudeArchive : piArchive)(path, offset);
  const parts = chunks(read.entries, runner.chunkBytes);
  let inserted = 0, skipped = 0, last: ArchiveOperationOutput<'archive_record'> | undefined;
  for (const [i, entries] of parts.entries()) {
    last = await runner.run('archive_record', { agent, nativeId, path, expectedOffset: offset, newOffset: i === parts.length - 1 ? read.offset : offset,
      read: { entries, name: read.name, cwd: read.cwd, parentNativeId: read.parentNativeId } });
    inserted += last.inserted;
    skipped += last.skipped;
  }
  return { archive: last!.archive, agent, nativeId, path, inserted, skipped, bytesRead: last!.bytesRead, key: last!.key };
}

export async function importArchive(runner: ArchiveRunner, c: Of<'archive_import'>) {
  const folders = c.dirs ? c.dirs.map(d => {
    const p = resolve(d.path);
    if (!(existsSync(p) && statSync(p).isDirectory())) throw new InputError('Not a directory: ' + p);
    return { agent: d.agent, path: p };
  }) : engineFolders(c.home, engineRoot().replace(/\/$/, ''));
  let archive: string | undefined;
  const total = { files: 0, inserted: 0, skipped: 0 };
  const failed: { agent: ArchiveAgent; path: string; error: string }[] = [];
  const dirs: { agent: ArchiveAgent; path: string; files: number; inserted: number; skipped: number }[] = [];
  for (const folder of folders) {
    const dir = { agent: folder.agent, path: folder.path, files: 0, inserted: 0, skipped: 0 };
    for (const path of listTranscripts(folder.path)) {
      try {
        const result = await recordFile(runner, folder.agent, path);
        archive ??= result.archive;
        dir.files++; dir.inserted += result.inserted; dir.skipped += result.skipped;
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
        failed.push({ agent: folder.agent, path, error: error.message });
      }
    }
    total.files += dir.files; total.inserted += dir.inserted; total.skipped += dir.skipped;
    dirs.push(dir);
  }
  return { archive: archive ?? (await runner.run('archive_status', {})).path, ...total, failed, dirs };
}

export async function captureArchive(runner: ArchiveRunner, c: Of<'archive_capture'>) {
  if (c.file === undefined) return { captured: false, file: null };
  const file = resolve(c.file);
  if (!(existsSync(file) && statSync(file).isFile())) return { captured: false, file };
  const { archive, ...rest } = await recordFile(runner, c.agent, file, c.nativeId);
  return { captured: true, archive, ...rest };
}

export function archiveStatus(filename: string) {
  return runArchiveOperation({ filename }, 'archive_status', {});
}

export function forgetArchive(filename: string, c: Of<'archive_forget'>) {
  const { name: _, ...input } = c;
  return runArchiveOperation({ filename }, 'archive_forget', input);
}

export function searchArchive(filename: string, c: Of<'archive_search'>) {
  const { name: _, ...input } = c;
  return runArchiveOperation({ filename }, 'archive_search', input);
}

export function showArchive(filename: string, c: Of<'archive_show'>) {
  const { name: _, ...input } = c;
  return runArchiveOperation({ filename }, 'archive_show', input);
}
