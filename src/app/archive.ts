import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppCommand } from './commands.js';
import { archivePath, createApp, createArchiveApp, engineRoot } from './create-app.js';
import { claudeFolderName, createImport, emptyCounts, forgetFilter, piFolderName } from '../modules/archive/public.js';
import type { ArchiveFolder, ArchiveKeys } from '../modules/archive/public.js';
import { claudeArchive } from '../infrastructure/transcript/claude-archive.js';
import { piArchive } from '../infrastructure/transcript/pi-archive.js';
import { listTranscripts } from '../infrastructure/transcript/transcript-files.js';
import { InputError } from '../shared/errors.js';

type Of<N extends AppCommand['name']> = Extract<AppCommand, { name: N }>;

export function engineFolders(home: string, cwd: string): ArchiveFolder[] {
  return [{ agent: 'claude', path: join(home, '.claude', 'projects', claudeFolderName(cwd)) },
    { agent: 'pi', path: join(home, '.pi', 'agent', 'sessions', piFolderName(cwd)) }];
}

export function importArchive(filename: string, c: Of<'archive_import'>) {
  const folders = c.dirs ? c.dirs.map(d => {
    const p = resolve(d.path);
    if (!(existsSync(p) && statSync(p).isDirectory())) throw new InputError('Not a directory: ' + p);
    return { agent: d.agent, path: p };
  }) : engineFolders(c.home, engineRoot().replace(/\/$/, ''));
  const { path, archive, close } = createArchiveApp(filename, false);
  try {
    return { archive: path, ...createImport(archive, { claude: claudeArchive, pi: piArchive }, { list: listTranscripts }).folders(folders) };
  } finally { close(); }
}

export function captureArchive(filename: string, c: Of<'archive_capture'>) {
  if (c.file === undefined) return { captured: false, file: null };
  const file = resolve(c.file);
  if (!(existsSync(file) && statSync(file).isFile())) return { captured: false, file };
  const { path, archive, close } = createArchiveApp(filename, false);
  try {
    return { captured: true, archive: path, ...createImport(archive, { claude: claudeArchive, pi: piArchive }, { list: listTranscripts }).file(c.agent, file, c.nativeId) };
  } finally { close(); }
}

export function archiveStatus(filename: string) {
  const path = archivePath(filename);
  if (!existsSync(path)) return { path, exists: false, bytes: 0, ...emptyCounts() };
  const { archive, close } = createArchiveApp(filename, true);
  try {
    return { path, exists: true, bytes: statSync(path).size, ...archive.counts() };
  } finally { close(); }
}

export function forgetArchive(filename: string, c: Of<'archive_forget'>) {
  const { name: _name, ...input } = c;
  forgetFilter(input);
  const path = archivePath(filename);
  if (!existsSync(path)) return { archive: path, sessions: 0, messages: 0 };
  const { archive, close } = createArchiveApp(filename, false);
  try {
    return { archive: path, ...archive.forget(input) };
  } finally { close(); }
}

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

export function searchArchive(filename: string, c: Of<'archive_search'>) {
  const { archive, close } = openForReading(filename);
  try {
    const { name: _, scope, ...input } = c;
    const keys = scope === undefined ? null : archiveScope(filename, scope);
    return archive.search({ ...input, keys });
  } finally { close(); }
}

export function showArchive(filename: string, c: Of<'archive_show'>) {
  const { archive, close } = openForReading(filename);
  try {
    const { name: _, ...input } = c;
    return archive.show(input);
  } finally { close(); }
}
