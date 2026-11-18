import type { AppCommand, OperationName, ScopeInput } from './commands.js';
import { createApp } from './create-app.js';
import { contextPathOf, createWorkspace, defaultContextRoot, workspaceRecords } from './create-workspace.js';
import { contextScope, resolveScope } from './resolve-scope.js';
import { taskRecords } from './task-work.js';
import { warmupScope } from './warmup.js';
import { sessionOperations } from './session-operations.js';
import { archiveOperations } from './archive-operations.js';
import type { ArchiveOperationInput, ArchiveOperationName } from './archive-operations.js';
import type { OperationTarget, SessionOperationInput, SessionOperationName } from './session-operations.js';
import { externalDatabasePath, trustedCheckoutPaths } from '../infrastructure/filesystem/paths.js';
import { frozenArtifacts } from '../modules/knowledge/public.js';
import { InputError } from '../shared/errors.js';

export type { OperationName, OperationTarget };
type CommandInput<K> = AppCommand extends infer C ? C extends { name: infer N } ? K extends N ? Omit<C, 'name'> : never : never : never;
export type OperationInputs = {
  task_create: { project: string; title: string; status: string; slug: string; parent?: string };
  task_status: { key: string; status: string; reason: string; session?: { agent: 'claude' | 'pi'; nativeId: string; pid?: number; runtime?: string }; envScope?: string };
  task_progress: { key: string; text: string; artifacts?: string[]; commit?: string };
  context_guard: { paths?: string[] };
  context_base: { scope: ScopeInput } | { project: string };
};
export type OperationInput<K extends OperationName> = K extends ArchiveOperationName ? ArchiveOperationInput<K> : K extends SessionOperationName ? SessionOperationInput<K>
  : K extends keyof OperationInputs ? OperationInputs[K] : CommandInput<K>;

type App = ReturnType<typeof createApp>;
type Workspace = ReturnType<typeof createWorkspace>;

function db<T>(t: OperationTarget, readonly: boolean, fn: (app: App) => T): T {
  const app = createApp(t.filename, readonly, undefined, t.trustedPaths ? trustedCheckoutPaths : undefined);
  try { return fn(app); } finally { app.close(); }
}

function workspace<T>(t: OperationTarget, fn: (app: Workspace) => T): T {
  const app = createWorkspace(t.filename, true, t.root);
  try { return fn(app); } finally { app.close(); }
}

function records<T>(t: OperationTarget, fn: (app: App, r: ReturnType<typeof workspaceRecords>, tasks: ReturnType<typeof taskRecords>) => T): T {
  if (!t.trustedPaths) externalDatabasePath(t.filename, t.root ?? defaultContextRoot());
  const app = createApp(t.filename, false, undefined, t.trustedPaths ? trustedCheckoutPaths : undefined);
  const r = workspaceRecords(app, () => new Date().toISOString());
  try { return fn(app, r, taskRecords(app, r.journal, r.taskKey)); } finally { app.close(); }
}

function callerOf(app: App, i: OperationInputs['task_status']): string | undefined {
  try {
    const key = i.session === undefined ? undefined : i.session.pid === undefined ? app.archiveKeys.byNative(i.session.agent, i.session.nativeId)
      : app.sessions(i.session.runtime).resolve({ agent: i.session.agent, nativeId: i.session.nativeId, pid: i.session.pid });
    return warmupScope(undefined, i.envScope, key);
  } catch { return undefined; }
}

const operations = {
  project_list: (t, i) => db(t, true, app => ({ projects: app.projects.list(i.org) })),
  project_add: (t, i) => db(t, false, app => ({ project: app.projects.add(i.identity, i.code, i.checkoutPath, i.repository) })),
  project_update: (t, i) => db(t, false, app => ({ project: app.projects.update(i.identity, {
    ...(i.checkoutPath === undefined ? {} : { checkout: { expected: i.expectedCheckoutPath ?? null, path: i.checkoutPath } }),
    ...(i.repository === undefined ? {} : { repository: { expected: i.expectedRepository ?? null, value: i.repository } }),
  }) })),
  project_resolve: (t, i) => db(t, true, app => app.projects.resolveCheckout(i.path)),
  project_remove: (t, i) => db(t, false, app => ({ removed: { project: app.projects.remove(i.identity, i.expectedCode) } })),
  org_remove: (t, i) => db(t, false, app => ({ removed: { organization: app.projects.removeOrganization(i.org) } })),
  status_list: t => db(t, true, app => app.tasks.statuses()),
  status_add: (t, i) => db(t, false, app => { app.tasks.addStatus(i.code, i.terminal); return { status: 'ok' }; }),
  status_rename: (t, i) => db(t, false, app => { app.tasks.renameStatus(i.code, i.newCode); return { status: 'ok' }; }),
  status_terminal: (t, i) => db(t, false, app => { app.tasks.setTerminal(i.code, i.terminal); return { status: 'ok' }; }),
  status_remove: (t, i) => db(t, false, app => { app.tasks.removeStatus(i.code); return { status: 'ok' }; }),
  task_list: (t, i) => workspace(t, app => app.readSnapshot(() => app.tasks.list(i))),
  task_show: (t, i) => workspace(t, app => app.readSnapshot(() => app.tasks.get(i.key))),
  journal_read: (t, i) => workspace(t, app => app.readSnapshot(() => app.history(i.scope === 'all' ? 'all' : resolveScope(i.scope, app.projects), {
    ...(i.from === undefined ? {} : { from: i.from }), ...(i.to === undefined ? {} : { to: i.to }),
    ...(i.eventType === undefined ? {} : { type: i.eventType }), ...(i.limit === undefined ? {} : { limit: i.limit }),
  }))),
  task_create: (t, i) => records(t, (_, __, tasks) => tasks.register(i, () => undefined)),
  task_status: (t, i) => records(t, (app, __, tasks) => tasks.change(i.key, { status: i.status }, i.reason, callerOf(app, i))),
  task_title: (t, i) => records(t, (_, __, tasks) => tasks.change(i.key, { title: i.title }, i.reason)),
  task_parent: (t, i) => records(t, (_, __, tasks) => tasks.setParent(i.key, i.parent, i.reason)),
  task_touch: (t, i) => records(t, (_, __, tasks) => tasks.touch(i.key)),
  task_progress: (t, i) => records(t, (_, __, tasks) => tasks.recordProgress(i.key, i.text, i.artifacts, i.commit)),
  journal_add: (t, i) => records(t, (app, r) => {
    const entry = r.journal.record(resolveScope(i.scope, app.projects), i.text);
    return { saved: app.serialize(() => r.journal.append(entry)) };
  }),
  context_guard: (t, i) => db(t, true, app => app.readSnapshot(() => ({ frozen: [...frozenArtifacts(app.journalStore)],
    fingerprints: (i.paths ?? []).flatMap(path => app.journalStore.fingerprint(path) ?? []) }))),
  context_base: (t, i) => db(t, true, app => {
    if ('project' in i) {
      if (app.projects.resolveScope(i.project).type !== 'project') throw new InputError('Error log requires project scope');
      return { path: contextPathOf(app.projects, i.project) };
    }
    return { path: contextPathOf(app.projects, contextScope(i.scope, app.projects)) };
  }),
  ...sessionOperations,
  ...archiveOperations,
} satisfies { [K in OperationName]: (t: OperationTarget, i: OperationInput<K>) => unknown };

export const OPERATION_NAMES: ReadonlySet<string> = new Set(Object.keys(operations));

export function isOperation(name: string): name is OperationName {
  return Object.hasOwn(operations, name);
}

export function runOperation<K extends OperationName>(t: OperationTarget, name: K, input: OperationInput<K>): unknown {
  return (operations[name] as (t: OperationTarget, i: OperationInput<K>) => unknown)(t, input);
}
