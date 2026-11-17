import type { AppCommand, OperationName } from './commands.js';
import { createApp } from './create-app.js';
import { createWorkspace } from './create-workspace.js';
import { resolveScope } from './resolve-scope.js';
import { trustedCheckoutPaths } from '../infrastructure/filesystem/paths.js';

export type { OperationName };
export type OperationInput<K extends AppCommand['name']> = AppCommand extends infer C ? C extends { name: infer N } ? K extends N ? Omit<C, 'name'> : never : never : never;
export type OperationTarget = { filename: string; root?: string; trustedPaths?: boolean };

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
  event_list: (t, i) => db(t, true, app => app.readSnapshot(() => app.events.browse(i))),
} satisfies { [K in OperationName]: (t: OperationTarget, i: OperationInput<K>) => unknown };

export const OPERATION_NAMES: ReadonlySet<string> = new Set(Object.keys(operations));

export function isOperation(name: string): name is OperationName {
  return Object.hasOwn(operations, name);
}

export function runOperation<K extends OperationName>(t: OperationTarget, name: K, input: OperationInput<K>): unknown {
  return (operations[name] as (t: OperationTarget, i: OperationInput<K>) => unknown)(t, input);
}
