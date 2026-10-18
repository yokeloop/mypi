import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, renameSync, lstatSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { backupGit, clonePublishedCommit } from '../infrastructure/git/backup-git.js';
import { relativeContextPath } from '../infrastructure/filesystem/context-files.js';
import { InputError } from '../shared/errors.js';
import { snapshotDatabase, restoreDatabase, withWriteLock } from '../infrastructure/database/backup.js';
import { contextGit, cloneContextBundle } from '../infrastructure/git/context-git.js';
import { contextFiles } from '../infrastructure/filesystem/context-files.js';
import { externalDatabasePath } from '../infrastructure/filesystem/paths.js';
import { createWorkspace, defaultContextRoot } from './create-workspace.js';
import { PartialError } from '../shared/context.js';

function hash(file: string): string { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
export function requiredReferences(filename: string, root: string): string[] {
  const required: string[] = [];
  const app = createWorkspace(filename, true, root), files = contextFiles(root);
  try {
    for (const card of app.requests.list()) {
      const parent = card.projectId === null ? undefined : app.projects.list().find(p => p.id === card.projectId);
      const prefix = parent ? 'projects/' + parent.org + '/' + parent.slug + '/requests/' : 'requests/';
      if (!card.contextDir.startsWith(prefix + card.key + '-')
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(card.contextDir.slice((prefix + card.key + '-').length))) throw new Error('Invalid request context link');
      app.verifyFile(card.contextDir + '/source.md');
      required.push(card.contextDir + '/source.md');
    }
    for (const entry of app.history('all')) for (const artifact of entry.artifacts ?? []) {
      if (!statSync(files.path(artifact)).isFile()) throw new Error('Missing artifact');
      app.verifyFile(artifact);
      required.push(artifact);
    }
  } finally { app.close(); }
  return [...new Set(required)];
}
export function verifyReferences(filename: string, root: string): void { requiredReferences(filename, root); }
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

export interface PublishBackupInput { filename: string; root?: string; selectedPaths?: string[]; dryRun?: boolean }
export interface PublishBackupResult {
  status: 'preview' | 'published' | 'partial';
  selectedPaths: string[]; excludedPaths: string[]; unpublishedCommits: string[];
  remote: string; ref: 'refs/heads/main'; base: string;
  snapshotSaved: boolean; commit?: string; publicationConfirmed: boolean;
  snapshotPath?: string; error?: string;
}
const generated = '.mypi-backup';
function externalVerificationDirectory(root: string): string {
  const parent = tmpdir();
  externalDatabasePath(join(parent, 'mypi-verification-check'), root);
  externalDatabasePath(join(parent, 'mypi-verification-check'), resolve(defaultContextRoot(), '..'));
  const temp = mkdtempSync(join(parent, 'mypi-backup-verify-'));
  try {
    externalDatabasePath(join(temp, 'state.sqlite3'), root);
    externalDatabasePath(join(temp, 'state.sqlite3'), resolve(defaultContextRoot(), '..'));
    return temp;
  } catch (error) { rmSync(temp, { recursive: true, force: true }); throw error; }
}
function selectedPath(path: string): void {
  relativeContextPath(path);
  if (path === generated || path.startsWith(generated + '/') || path === 'pi/APPEND_SYSTEM.md'
    || /(^|\/)(?:\.env(?:\..*)?|credentials?|secrets?|tokens?|cache|\.cache|node_modules|sessions?|chats?)(\/|$)/i.test(path)) {
    throw new InputError('Reserved or sensitive file selection: ' + path);
  }
}
export async function publishBackup(input: PublishBackupInput): Promise<PublishBackupResult> {
  const root = resolve(input.root ?? defaultContextRoot()), filename = input.filename;
  externalDatabasePath(filename, root);
  const git = backupGit(root), remote = git.branch(), base = git.head();
  if (!base) throw new InputError('Home must have a committed baseline');
  const remoteAtStart = git.remoteHead();
  // A remote tip can be absent locally (e.g. another publisher advanced it).
  // Never fetch or silently reconcile it; in that case disclose all local ancestry.
  let remoteKnown = false;
  if (remoteAtStart) {
    try { remoteKnown = git.run(['cat-file', '-t', remoteAtStart]).trim() === 'commit'; } catch { /* unknown remote object */ }
  }
  const ancestors = git.run(['rev-list', '--reverse', base, ...(remoteKnown ? ['^' + remoteAtStart] : [])]).trim();
  const unpublishedCommits = ancestors ? ancestors.split('\n') : [];
  const explicit = input.selectedPaths ?? [];
  for (const path of explicit) selectedPath(path);
  if (new Set(explicit).size !== explicit.length) throw new InputError('Duplicate selected file');
  const required = requiredReferences(filename, root);
  const selectedPaths = [...new Set([...required, ...explicit])].sort();
  if (git.ignored(generated + '/state.sqlite3') || git.ignored(generated + '/manifest.json')) {
    throw new InputError('Generated backup is excluded by Git');
  }
  for (const path of selectedPaths) {
    if (git.ignored(path)) throw new InputError('Required or selected file is excluded by Git: ' + path);
    git.safe(path);
    if (path !== 'pi/APPEND_SYSTEM.md' && !lstatSync(contextFiles(root).path(path)).isFile()) throw new InputError('Selected file must be regular');
  }
  contextGit(root).validate(required);
  const excludedPaths = [...new Set(git.changed().filter(path => !selectedPaths.includes(path) && !path.startsWith(generated + '/')))].sort();
  const result: PublishBackupResult = { status: 'preview', selectedPaths, excludedPaths, unpublishedCommits,
    remote, ref: 'refs/heads/main', base, snapshotSaved: false, publicationConfirmed: false };
  if (input.dryRun) return result;
  // The bounded SQLite write transaction serializes cooperating writers and backup callers.
  try { await withWriteLock(filename, async () => {
    let snapshotSaved = false;
    try {
      if (git.head() !== base) throw new InputError('Home HEAD changed during backup');
      const bytes = new Map<string, Buffer | string>();
      const preimages = new Map<string, Buffer>();
      for (const path of selectedPaths) {
        const content = readFileSync(contextFiles(root).path(path));
        preimages.set(path, content);
        bytes.set(path, content);
      }
      const backupRoot = contextFiles(root).path(generated);
      if (existsSync(backupRoot) && !lstatSync(backupRoot).isDirectory()) throw new InputError('Backup path is not a directory');
      mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
      for (const name of ['state.sqlite3', 'manifest.json']) {
        const target = contextFiles(root).path(generated + '/' + name);
        if (existsSync(target) && (!lstatSync(target).isFile() || lstatSync(target).nlink !== 1)) throw new InputError('Unsafe generated backup file');
      }
      const temp = mkdtempSync(join(backupRoot, '.snapshot-'));
      try {
        const snapshot = join(temp, 'state.sqlite3');
        await snapshotDatabase(filename, snapshot);
        const snapshotBytes = readFileSync(snapshot);
        // Verify the bytes which will become Git objects, not mutable worktree bytes.
        const verification = externalVerificationDirectory(root);
        try {
          const probe = join(verification, 'home');
          mkdirSync(probe);
          const verifiedSnapshot = join(verification, 'state.sqlite3');
          copyFileSync(snapshot, verifiedSnapshot);
          for (const path of git.tracked(base)) {
            if (path.startsWith(generated + '/')) continue;
            relativeContextPath(path);
            const mode = git.mode(base, path);
            if (mode !== '100644' && mode !== '100755' && !(mode === '120000' && path === 'pi/APPEND_SYSTEM.md'
              && git.read(base, path).toString() === '../USER-INSTRUCTIONS.md')) throw new InputError('Unsafe committed home path: ' + path);
            if (path === 'pi/APPEND_SYSTEM.md') continue;
            const target = contextFiles(probe).path(path);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, git.read(base, path), { flag: 'wx', mode: 0o600 });
          }
          for (const path of selectedPaths) {
            const target = contextFiles(probe).path(path);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, preimages.get(path)!, { mode: 0o600 });
          }
          verifyReferences(verifiedSnapshot, probe);
        } finally { rmSync(verification, { recursive: true, force: true }); }
        if (git.head() !== base || selectedPaths.some(path => !readFileSync(contextFiles(root).path(path)).equals(preimages.get(path)!))) {
          throw new InputError('Home changed during backup');
        }
        const manifest = Buffer.from(JSON.stringify({ version: 2, schemaVersion: 2, files: { 'state.sqlite3': createHash('sha256').update(snapshotBytes).digest('hex') } }) + '\n');
        bytes.set(generated + '/state.sqlite3', snapshotBytes);
        bytes.set(generated + '/manifest.json', manifest);
        // Retain a local artifact even if commit/push fails. The previous committed snapshot remains in Git history.
        for (const [name, content] of [['state.sqlite3', snapshotBytes], ['manifest.json', manifest]] as const) {
          const target = join(backupRoot, name), pending = join(temp, name + '.pending');
          writeFileSync(pending, content, { mode: 0o600 });
          renameSync(pending, target);
        }
        snapshotSaved = true;
        result.snapshotSaved = true;
        result.snapshotPath = backupRoot;
        result.commit = git.commit(base, bytes);
      } finally { rmSync(temp, { recursive: true, force: true }); }
    } catch (error) {
      result.status = 'partial'; result.snapshotSaved = snapshotSaved;
      result.error = String(error);
    }
  }); } catch (error) {
    result.status = 'partial'; result.error = String(error);
  }
  if (!result.commit) return result;
  try {
    git.push(result.commit!);
    result.publicationConfirmed = git.remoteHead() === result.commit;
    if (!result.publicationConfirmed) throw new Error('Remote main did not confirm published commit');
    result.status = 'published';
  } catch (error) {
    result.status = 'partial'; result.error = String(error);
    // Inspect once after an uncertain push; do not retry or claim rollback.
    try { result.publicationConfirmed = git.remoteHead() === result.commit; if (result.publicationConfirmed) result.status = 'published'; }
    catch (inspectionError) { result.error += '; remote inspection: ' + String(inspectionError); }
  }
  return result;
}

export interface RestorePublishedInput { repository: string; commit: string; filename: string; root: string }
export function restorePublishedBackup(input: RestorePublishedInput): ReturnType<typeof restoreState> {
  const { repository, commit, filename, root } = input;
  externalDatabasePath(filename, root);
  externalDatabasePath(filename, resolve(defaultContextRoot(), '..'));
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new InputError('Full commit hash required');
  if (existsSync(root) || existsSync(filename)) throw new InputError('Restore only into absent DB and context');
  const git = backupGit(repository);
  if (git.run(['cat-file', '-t', commit]).trim() !== 'commit') throw new InputError('Commit required');
  const paths = git.tracked(commit);
  if (!paths.includes(generated + '/state.sqlite3') || !paths.includes(generated + '/manifest.json')) throw new InputError('Missing published snapshot');
  for (const path of paths) {
    relativeContextPath(path);
    const mode = git.mode(commit, path);
    if (!['100644', '100755'].includes(mode) && !(path === 'pi/APPEND_SYSTEM.md' && mode === '120000'
      && git.read(commit, path).toString() === '../USER-INSTRUCTIONS.md')) throw new InputError('Unsafe committed home path: ' + path);
  }
  const manifest: unknown = JSON.parse(git.read(commit, generated + '/manifest.json').toString('utf8'));
  const data = manifest as { version?: number; schemaVersion?: number; files?: Record<string, string> };
  if (data?.version !== 2 || data.schemaVersion !== 2 || !data.files || Object.keys(data.files).join(',') !== 'state.sqlite3'
    || !/^[a-f0-9]{64}$/.test(data.files['state.sqlite3'] ?? '')) throw new InputError('Invalid published manifest');
  const snapshot = git.read(commit, generated + '/state.sqlite3');
  if (createHash('sha256').update(snapshot).digest('hex') !== data.files['state.sqlite3']) throw new InputError('Backup checksum mismatch');
  const temp = externalVerificationDirectory(root);
  try {
    const saved = join(temp, 'state.sqlite3'), probe = join(temp, 'home');
    writeFileSync(saved, snapshot, { mode: 0o600 });
    mkdirSync(probe);
    for (const path of paths) {
      if (path === 'pi/APPEND_SYSTEM.md') continue;
      const target = contextFiles(probe).path(path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, git.read(commit, path), { flag: 'wx', mode: 0o600 });
    }
    verifyReferences(saved, probe);
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    restoreDatabase(saved, filename);
    // Clone the selected commit, never the source clone's mutable working tree.
    clonePublishedCommit(repository, commit, root);
    verifyReferences(filename, root);
    return { status: 'ok', database: filename, context: root };
  } catch (error) { throw new PartialError(String(error), [], ['inspect restored DB/context'], [filename, root]); }
  finally { rmSync(temp, { recursive: true, force: true }); }
}
