import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { snapshotDatabase, restoreDatabase, withWriteLock } from '../infrastructure/database/backup.js';
import { contextGit, cloneContextBundle } from '../infrastructure/git/context-git.js';
import { contextFiles } from '../infrastructure/filesystem/context-files.js';
import { externalDatabasePath } from '../infrastructure/filesystem/paths.js';
import { createWorkspace, defaultContextRoot } from './create-workspace.js';
import { PartialError } from '../shared/context.js';

function hash(file: string): string { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
export function verifyReferences(filename: string, root: string): void {
  const app = createWorkspace(filename, true, root), files = contextFiles(root);
  try {
    for (const card of app.requests.list()) {
      const parent = card.projectId === null ? undefined : app.projects.list().find(p => p.id === card.projectId);
      const prefix = parent ? 'projects/' + parent.org + '/' + parent.slug + '/requests/' : 'requests/';
      if (!card.contextDir.startsWith(prefix + card.key + '-')
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(card.contextDir.slice((prefix + card.key + '-').length))) throw new Error('Invalid request context link');
      if (files.read(card.contextDir + '/source.md') === undefined) throw new Error('Missing request source');
    }
    for (const entry of app.history('all')) for (const artifact of entry.artifacts ?? []) {
      if (!statSync(files.path(artifact)).isFile()) throw new Error('Missing artifact');
    }
  } finally { app.close(); }
}
export async function backupState(filename: string, destination: string, root = defaultContextRoot()) {
  externalDatabasePath(filename, root);
  destination = resolve(destination);
  externalDatabasePath(destination, root);
  externalDatabasePath(destination, resolve(defaultContextRoot(), '..'));
  return withWriteLock(filename, async () => {
    const git = contextGit(root), hasContext = existsSync(root);
    if (hasContext) git.cleanAll();
    verifyReferences(filename, root);
    mkdirSync(destination, { recursive: false, mode: 0o700 });
    const files: Record<string, string> = {};
    try {
      await snapshotDatabase(filename, join(destination, 'state.sqlite3'));
      files['state.sqlite3'] = hash(join(destination, 'state.sqlite3'));
      const head = hasContext ? git.head() : undefined;
      if (head) { git.bundle(join(destination, 'context.bundle')); files['context.bundle'] = hash(join(destination, 'context.bundle')); }
      if (existsSync(root) !== hasContext || (hasContext && git.head() !== head)) throw new Error('Context changed during backup');
      if (hasContext) git.cleanAll();
      // Validate actual saved objects, not only the live worktree, before publishing a manifest.
      const probe = mkdtempSync(join(destination, '.verify-'));
      try {
        const savedRoot = join(probe, 'home');
        if (head) cloneContextBundle(join(destination, 'context.bundle'), savedRoot);
        else contextGit(savedRoot).initialize();
        verifyReferences(join(destination, 'state.sqlite3'), savedRoot);
      } finally { rmSync(probe, { recursive: true, force: true }); }
      writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ version: 1, files }) + '\n', { flag: 'wx', mode: 0o600 });
      return { status: 'ok', destination };
    } catch (e) { throw new PartialError(String(e), [], ['inspect incomplete backup'], [destination]); }
  });
}
export function restoreState(backup: string, filename: string, root = defaultContextRoot()) {
  externalDatabasePath(filename, root);
  externalDatabasePath(filename, resolve(defaultContextRoot(), '..'));
  const raw: unknown = JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8'));
  const manifest = raw as { version: number; files: Record<string, string> };
  if (!manifest || manifest.version !== 1 || !manifest.files || typeof manifest.files !== 'object'
    || !manifest.files['state.sqlite3'] || Object.keys(manifest.files).some(p => !['state.sqlite3', 'context.bundle'].includes(p))) throw new Error('Invalid backup manifest');
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (hash(contextFiles(backup).path(file)) !== expected) throw new Error('Backup checksum mismatch');
  }
  contextFiles(root).path('MEMORY.md');
  if (existsSync(filename) || existsSync(root)) throw new Error('Restore only into absent DB and context; existing state is never overwritten');
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  try {
    restoreDatabase(join(backup, 'state.sqlite3'), filename);
    if (manifest.files['context.bundle']) cloneContextBundle(join(backup, 'context.bundle'), root);
    else contextGit(root).initialize();
    contextGit(root).cleanAll();
    verifyReferences(filename, root);
    return { status: 'ok', database: filename, context: root };
  } catch (e) { throw new PartialError(String(e), [], ['inspect restored DB/context'], [filename, root]); }
}
