import { randomUUID } from 'node:crypto';
import { createInbox } from '../modules/inbox/public.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, initializeState } from './create-app.js';
import { contextFiles } from '../infrastructure/filesystem/context-files.js';
import { externalDatabasePath } from '../infrastructure/filesystem/paths.js';
import { contextGit } from '../infrastructure/git/context-git.js';
import { createJournal, createJournalBrowser, createNotes } from '../modules/knowledge/public.js';
import type { ScopeIndex } from '../modules/knowledge/public.js';
import { importLegacyJournal } from './import-journal.js';
import { migrateTaskDirectories } from './migrate-tasks.js';
import { fileFingerprint, matchesFingerprint } from './file-fingerprints.js';
import { sameScope, scopeValue } from '../shared/scope.js';
import type { Scope } from '../shared/scope.js';
import type { Card } from '../modules/tasks/public.js';
import type { Project } from '../modules/projects/public.js';
import { InputError } from '../shared/errors.js';
import { changeContext } from './context-changes.js';
import { taskWork } from './task-work.js';
import type { ContextFiles } from '../shared/context.js';
import type { FileFingerprint } from '../modules/knowledge/public.js';

export function defaultContextRoot(): string { return fileURLToPath(new URL('../../../home', import.meta.url)); }
export function initializeWorkspace(filename: string, root = defaultContextRoot()): void {
  externalDatabasePath(filename, root);
  initializeState(filename);
  contextGit(root).initialize();
}
export function workspaceRecords(database: ReturnType<typeof createApp>, clock: () => string) {
  function project(id: number) {
    const result = database.projects.list().find(p => p.id === id);
    if (!result) throw new InputError('Unknown parent project');
    return result;
  }
  function taskKey(card: Card): string { return (card.projectId === null ? 'REQ' : project(card.projectId).code) + '-' + card.number; }
  function scopeIndex(): ScopeIndex {
    const projects = database.projects.list();
    const byId = new Map(projects.map(p => [p.id, p]));
    const byCode = new Map(projects.map(p => [p.code, p]));
    const tasks = new Map<string, Project | null>();
    for (const card of database.tasks.list()) {
      if (card.projectId === null) { tasks.set('REQ-' + card.number, null); continue; }
      const project = byId.get(card.projectId);
      if (!project) throw new InputError('Unknown parent project');
      tasks.set(project.code + '-' + card.number, project);
    }
    const orgs = new Set<string>();
    return {
      resolve(scope: Scope): void {
        scopeValue(scope);
        if (scope.type === 'org' && !orgs.has(scope.key)) { database.projects.resolveScope(scope.key); orgs.add(scope.key); }
        if (scope.type === 'project' && !byCode.has(scope.key)) throw new InputError('Unknown project');
        if (scope.type === 'task' && !tasks.has(scope.key)) throw new InputError('Unknown task');
      },
      contains(filter: Scope, scope: Scope): boolean {
        if (sameScope(filter, scope)) return true;
        if (scope.type === 'task') {
          const p = tasks.get(scope.key);
          if (!p) return false;
          return (filter.type === 'org' && filter.key === p.org) || (filter.type === 'project' && filter.key === p.code);
        }
        if (scope.type === 'project' && filter.type === 'org') return byCode.get(scope.key)?.org === filter.key;
        return false;
      },
    };
  }
  function resolve(scope: Scope): void { scopeIndex().resolve(scope); }
  const journal = createJournal(database.journalStore, resolve, scopeIndex, clock);
  const browser = createJournalBrowser(database.journalStore, scopeIndex);
  return { taskKey, resolve, journal, browser };
}

export function contextPathOf(projects: ReturnType<typeof createApp>['projects'], scope?: string): string {
  const resolved = projects.resolveScope(scope);
  if (resolved.type === 'global') return '';
  return resolved.type === 'org' ? 'projects/' + resolved.slug : join('projects', resolved.project.org, resolved.project.slug);
}

type HomeGit = ReturnType<typeof contextGit>;
type HomeFiles = ContextFiles & { path(path: string): string };

export function homeTexts(files: HomeFiles, git: HomeGit, serialize: <T>(work: () => T) => T) {
  return {
    read: files.read, list: files.list,
    create(path: string, text: string) { serialize(() => changeContext(git, [path], () => files.create(path, text), 'Create ' + path)); },
    edit(path: string, update: (old: string | undefined) => string) {
      serialize(() => {
        const old = files.read(path), next = update(old);
        changeContext(git, [path], () => { if (old === undefined) files.create(path, next); else files.replace(path, next, old); }, 'Update ' + path);
      });
    },
  };
}

export function homeWriters(texts: ReturnType<typeof homeTexts>, clock: () => string) {
  const name = () => clock().replace(/:/g, '-') + '-' + randomUUID();
  return { inbox: createInbox(texts, name), notes: createNotes(texts, name, clock) };
}

export function completePaths(git: HomeGit, files: HomeFiles, frozen: ReadonlySet<string>,
  fingerprint: (path: string) => FileFingerprint | undefined, clock: () => string, paths: string[], message: string): string {
  for (const path of paths) if (frozen.has(path)) {
    const saved = fingerprint(path);
    if (saved) matchesFingerprint(saved, fileFingerprint(files, path, clock()));
    else throw new InputError('Historical artifact requires explicit reconciliation: ' + path);
  }
  return git.commit(paths, message);
}

export function restorePath(git: HomeGit, frozen: ReadonlySet<string>, serialize: <T>(work: () => T) => T, path: string, revision: string): string {
  if (frozen.has(path)) throw new InputError('Registered file cannot be restored');
  return serialize(() => git.restoreFile(path, revision));
}

export function deviceHome(root: string, frozen: ReadonlySet<string>, fingerprints: ReadonlyMap<string, FileFingerprint>, clock = () => new Date().toISOString()) {
  const files = contextFiles(root), git = contextGit(root, () => frozen);
  const serialize = <T>(work: () => T): T => { git.validateJournal(); return work(); };
  const texts = homeTexts(files, git, serialize), { inbox, notes } = homeWriters(texts, clock);
  return {
    files, git, capture: inbox.capture, note: notes.note, error: notes.error,
    complete: (paths: string[], message: string) => serialize(() => completePaths(git, files, frozen, p => fingerprints.get(p), clock, paths, message)),
    restoreContext: (path: string, revision: string) => restorePath(git, frozen, serialize, path, revision),
    read: files.read,
    readVersion: (path: string, revision: string) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(git.readVersion(path, revision)),
  };
}

export function createWorkspace(filename: string, readonly: boolean, root = defaultContextRoot(), clock = () => new Date().toISOString()) {
  externalDatabasePath(filename, root);
  const database = createApp(filename, readonly, clock), files = contextFiles(root);
  let frozen: ReadonlySet<string> = new Set();
  const git = contextGit(root, () => frozen);
  const core = { ...database, serialize<T>(work: () => T): T {
    return database.serialize(() => {
      git.validateJournal();
      const previous = frozen; frozen = journal.frozen();
      try { return work(); } finally { frozen = previous; }
    });
  } };
  const { taskKey, resolve, journal, browser } = workspaceRecords(database, clock);
  function verifyFile(path: string): void {
    const saved = database.journalStore.fingerprint(path);
    if (!saved) throw new InputError('Unregistered file requires explicit reconciliation: ' + path);
    matchesFingerprint(saved, fileFingerprint(files, path, clock()));
  }
  const tasks = taskWork(database, files, database.journalStore, journal, { commit(paths: string[], message: string) {
    const previous = frozen; frozen = journal.frozen();
    try { return git.commit(paths, message); } finally { frozen = previous; }
  } }, taskKey, clock);
  const contextPath = (scope?: string): string => contextPathOf(core.projects, scope);
  const texts = homeTexts(files, git, core.serialize);
  const { inbox, notes } = homeWriters(texts, clock);
  return {
    projects: core.projects, close: core.close, tasks, readSnapshot: database.readSnapshot,
    statuses: {
      statuses: core.tasks.statuses, addStatus: core.tasks.addStatus,
      renameStatus: core.tasks.renameStatus, setTerminal: core.tasks.setTerminal,
      removeStatus: core.tasks.removeStatus,
    },
    history: journal.read,
    historyPage: browser.page,
    journal(scope: Scope, text: string) {
      const entry = journal.record(scope, text);
      return database.serialize(() => journal.append(entry));
    },
    importJournal() { return importLegacyJournal(files, git, database.journalStore, database.serialize, clock,
      database.tasks.list().map(card => card.contextDir + '/source.md'), resolve); },
    migrateTasks(dryRun: boolean) { return migrateTaskDirectories(database, files, git, taskKey, dryRun); },
    verifyFile,
    read: files.read,
    readVersion: (path: string, revision: string) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(git.readVersion(path, revision)),
    restoreContext(path: string, revision: string) { return restorePath(git, journal.frozen(), core.serialize, path, revision); },
    complete(paths: string[], message: string) {
      return core.serialize(() => completePaths(git, files, journal.frozen(), database.journalStore.fingerprint, clock, paths, message));
    },
    contextPath,
    capture: inbox.capture,
    note: (title: string, text: string, scope?: string) => notes.note(contextPath(scope), title, text),
    error(scope: string, text: string) {
      if (core.projects.resolveScope(scope).type !== 'project') throw new InputError('Error log requires project scope');
      return notes.error(contextPath(scope), text);
    },
  };
}
