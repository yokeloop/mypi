import { initializeDatabase, openDatabase } from '../infrastructure/database/database.js';
import { initializeArchive, openArchive } from '../infrastructure/database/archive.js';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { archiveDatabasePath, canonicalAbsoluteDirectory, canonicalDirectory, databasePath, externalDatabasePath, sessionRegistryDir } from '../infrastructure/filesystem/paths.js';
import { sqliteProjectStore } from '../modules/projects/adapters/sqlite-project-store.js';
import { createTasks } from '../modules/tasks/public.js';
import { sqliteTaskStore } from '../modules/tasks/adapters/sqlite-task-store.js';
import { createProjects, validSlug } from '../modules/projects/public.js';
import { sqliteJournalStore } from '../modules/knowledge/public.js';
import { createSessions } from '../modules/sessions/public.js';
import type { SessionScope } from '../modules/sessions/ports.js';
import { sqliteSessionStore } from '../modules/sessions/adapters/sqlite-session-store.js';
import { fsRegistry } from '../modules/sessions/adapters/fs-registry.js';
import { createEvents } from '../modules/events/public.js';
import { sqliteEventStore } from '../modules/events/adapters/sqlite-event-store.js';
import { createArchive } from '../modules/archive/public.js';
import type { KeyLookup } from '../modules/archive/ports.js';
import { sqliteArchiveStore } from '../modules/archive/adapters/sqlite-archive-store.js';
import { InputError } from '../shared/errors.js';

export { SCHEMA_VERSION } from '../infrastructure/database/database.js';

export function engineRoot(): string {
  return fileURLToPath(new URL('../../../', import.meta.url));
}

export function engineVersion(): string {
  return (JSON.parse(readFileSync(join(engineRoot(), 'package.json'), 'utf8')) as { version: string }).version;
}

export function resolveStatePath(env: Readonly<Record<string, string | undefined>>, home: string): string {
  return databasePath(env, home, engineRoot());
}

export function initializeState(filename: string, createOnly = false): void {
  initializeDatabase(externalDatabasePath(filename, engineRoot()), createOnly);
}

export function createApp(filename: string, readonly: boolean, clock = () => new Date().toISOString()) {
  const db = openDatabase(externalDatabasePath(filename, engineRoot()), readonly);
  const projects = createProjects(sqliteProjectStore(db), { canonicalDirectory, canonicalAbsoluteDirectory });
  const sessionScope = (key: string): SessionScope => {
    if (key === 'global') return { scopeType: 'global', orgId: null, projectId: null, taskId: null };
    if (/^[A-Z]+$/.test(key)) {
      const project = projects.list().find(p => p.code === key);
      if (!project) throw new InputError('Unknown project: ' + key);
      return { scopeType: 'project', orgId: null, projectId: project.id, taskId: null };
    }
    if (/^[A-Z]+-[1-9][0-9]*$/.test(key)) {
      const list = projects.list();
      const card = sqliteTaskStore(db).list().find(c => (c.projectId === null ? 'REQ' : list.find(p => p.id === c.projectId)!.code) + '-' + c.number === key);
      if (!card) throw new InputError('Unknown task: ' + key);
      if (card.projectId === null) throw new InputError('Task ' + key + ' has no project; sessions need a task of a registered project');
      return { scopeType: 'task', orgId: null, projectId: card.projectId, taskId: card.id };
    }
    if (key === 'all') throw new InputError('all is reserved for /inbox all and is not a session key');
    if (validSlug(key)) {
      const scope = projects.resolveScope(key);
      return { scopeType: 'org', orgId: scope.type === 'org' ? scope.id : null, projectId: null, taskId: null };
    }
    throw new InputError('Invalid session key: ' + key + '; use global, an organization slug (tb-ff), a project code (MP) or a task key (MP-12)');
  };
  const orgOf = (code: string): string | undefined => projects.list().find(p => p.code === code)?.org;
  const parents = (key: string): string[] => {
    const task = /^([A-Z]+)-[1-9][0-9]*$/.exec(key);
    if (task) {
      const org = orgOf(task[1]!);
      return org === undefined ? [task[1]!] : [task[1]!, org];
    }
    if (/^[A-Z]+$/.test(key)) return ['global'];
    if (key !== 'global' && key !== 'all' && validSlug(key)) return ['global'];
    return [];
  };
  const archiveKeys: KeyLookup = {
    byNative: (agent, nativeId) => sqliteSessionStore(db).byNative(agent, nativeId)?.key,
    registered: key => {
      try { sessionScope(key); return true; } catch (error) { if (error instanceof InputError) return false; throw error; }
    },
  };
  return {
    readSnapshot: <T>(fn: () => T): T => db.transaction(fn)(),
    serialize: <T>(fn: () => T): T => { if (readonly) throw new Error('Readonly application'); return db.transaction(fn).immediate(); },
    tasks: createTasks(sqliteTaskStore(db), clock, id => {
      const project = projects.list().find(p => p.id === id);
      if (!project) throw new Error('Unknown parent project');
      return { code: project.code, prefix: 'projects/' + project.org + '/' + project.slug + '/tasks' };
    }),
    projects,
    journalStore: sqliteJournalStore(db),
    sessions: (runtime: string | undefined, proc = '/proc') => createSessions(sqliteSessionStore(db), () => fsRegistry(sessionRegistryDir(runtime), proc), sessionScope, orgOf, clock),
    events: createEvents(sqliteEventStore(db), sessionScope, parents, clock),
    archiveKeys,
    close: () => db.close(),
  };
}

export function archivePath(filename: string): string {
  return archiveDatabasePath(filename, engineRoot());
}

export function createArchiveApp(filename: string, readonly: boolean, clock = () => new Date().toISOString()) {
  const state = createApp(filename, true);
  try {
    const path = archivePath(filename);
    if (!readonly) initializeArchive(path);
    const db = openArchive(path, readonly);
    return { path, archive: createArchive(sqliteArchiveStore(db), state.archiveKeys, clock), close: () => { db.close(); state.close(); } };
  } catch (error) {
    state.close();
    throw error;
  }
}
