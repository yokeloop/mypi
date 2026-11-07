import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppCommand } from './commands.js';
import { archivePath, createArchiveApp, engineRoot } from './create-app.js';
import { claudeFolderName, createImport, emptyCounts, piFolderName } from '../modules/archive/public.js';
import type { ArchiveFolder } from '../modules/archive/public.js';
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

export function archiveStatus(filename: string) {
  const path = archivePath(filename);
  if (!existsSync(path)) return { path, exists: false, bytes: 0, ...emptyCounts() };
  const { archive, close } = createArchiveApp(filename, true);
  try {
    return { path, exists: true, bytes: statSync(path).size, ...archive.counts() };
  } finally { close(); }
}
