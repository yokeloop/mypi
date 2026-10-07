import { initializeDatabase, openDatabase } from '../infrastructure/database/database.js';
import { fileURLToPath } from 'node:url';
import { canonicalDirectory, databasePath, externalDatabasePath } from '../infrastructure/filesystem/paths.js';
import { sqliteProjectStore } from '../modules/projects/adapters/sqlite-project-store.js';
import { createRequests } from '../modules/requests/public.js';
import { sqliteRequestStore } from '../modules/requests/adapters/sqlite-request-store.js';
import { createProjects } from '../modules/projects/public.js';

function engineRoot(): string {
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
  const projects = createProjects(sqliteProjectStore(db), { canonicalDirectory });
  return {
    serialize: <T>(fn: () => T): T => { if (readonly) throw new Error('Readonly application'); return db.transaction(fn).immediate(); },
    requests: createRequests(sqliteRequestStore(db), clock, id => {
      const project = projects.list().find(p => p.id === id);
      if (!project) throw new Error('Unknown parent project');
      return { code: project.code, prefix: 'projects/' + project.org + '/' + project.slug + '/requests' };
    }),
    projects,
    close: () => db.close(),
  };
}
