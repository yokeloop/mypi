import { initializeDatabase, openDatabase } from '../infrastructure/database/database.js';
import { fileURLToPath } from 'node:url';
import { canonicalAbsoluteDirectory, canonicalDirectory, databasePath, externalDatabasePath, sessionRegistryDir } from '../infrastructure/filesystem/paths.js';
import { sqliteProjectStore } from '../modules/projects/adapters/sqlite-project-store.js';
import { createTasks } from '../modules/tasks/public.js';
import { sqliteTaskStore } from '../modules/tasks/adapters/sqlite-task-store.js';
import { createProjects } from '../modules/projects/public.js';
import { sqliteJournalStore } from '../modules/knowledge/public.js';
import { createSessions } from '../modules/sessions/public.js';
import type { SessionScope } from '../modules/sessions/ports.js';
import { sqliteSessionStore } from '../modules/sessions/adapters/sqlite-session-store.js';
import { fsRegistry } from '../modules/sessions/adapters/fs-registry.js';
import { createEvents } from '../modules/events/public.js';
import { sqliteEventStore } from '../modules/events/adapters/sqlite-event-store.js';
import { InputError } from '../shared/errors.js';

export function engineRoot(): string {
  return fileURLToPath(new URL('../../../', import.meta.url));
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
    if (key === 'global') return { scopeType: 'global', projectId: null, taskId: null };
    if (/^[A-Z]+$/.test(key)) {
      const project = projects.list().find(p => p.code === key);
      if (!project) throw new InputError('Unknown project: ' + key);
      return { scopeType: 'project', projectId: project.id, taskId: null };
    }
    if (/^[A-Z]+-[1-9][0-9]*$/.test(key)) {
      const list = projects.list();
      const card = sqliteTaskStore(db).list().find(c => (c.projectId === null ? 'REQ' : list.find(p => p.id === c.projectId)!.code) + '-' + c.number === key);
      if (!card) throw new InputError('Unknown task: ' + key);
      if (card.projectId === null) throw new InputError('Task ' + key + ' has no project; sessions need a task of a registered project');
      return { scopeType: 'task', projectId: card.projectId, taskId: card.id };
    }
    throw new InputError('Invalid session key: ' + key + '; use global, a project code (MP) or a task key (MP-12)');
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
    sessions: (runtime: string | undefined, proc = '/proc') => createSessions(sqliteSessionStore(db), () => fsRegistry(sessionRegistryDir(runtime), proc), sessionScope, clock),
    events: createEvents(sqliteEventStore(db), sessionScope, clock),
    close: () => db.close(),
  };
}
