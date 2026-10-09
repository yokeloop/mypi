import { executeSessionCommand } from './session-cards.js';
import type { AppCommand } from './commands.js';
import type { WorkContext } from '../modules/work-context/public.js';
import { executePolicyCommand } from './policy-commands.js';
import { executeWorkspaceOperation } from './workspace-operations.js';
import { createWorkspace, defaultContextRoot, initializeWorkspace } from './create-workspace.js';
import { realpathSync } from 'node:fs';
import { createHomeWriter } from './home-writer.js';
import type { HomeWriteScope } from '../shared/home-writer.js';
import { createApp, initializeState } from './create-app.js';
import { backupState, restoreState } from './backup.js';
import { inputText } from './input-text.js';
import { contextScope, resolveScope } from './resolve-scope.js';
import { InputError } from '../shared/errors.js';
import { commandMembership, hasMembershipGuard } from './command-membership.js';
import type { GuardWarningResult, SelectedGuardPolicy } from './command-membership.js';
import { loadSelectedGuardPolicy } from './guard-policy-config.js';
export type { GuardWarningResult, SelectedGuardPolicy } from './command-membership.js';

const reads = new Set(['warmup', 'memory_show', 'journal_read', 'request_list', 'request_show', 'context_read']);
const managed = new Set(['capture', 'note_add', 'error_add', 'memory_add', 'memory_remove', 'journal_add',
  'request_create', 'request_status', 'request_title', 'request_progress', 'home_document_patch']);
export function isManagedHomeCommand(name: string): boolean { return managed.has(name); }
// WorkContext is an out-of-band working selection, not authentication.
export async function executeCommand(c: AppCommand, filename: string, root?: string, context?: WorkContext,
  selectedPolicy?: SelectedGuardPolicy): Promise<unknown> {
  if (c.name === 'session_list' || c.name === 'session_show' || c.name === 'session_archive') {
    return executeSessionCommand(c, context, root === undefined ? undefined : { contextRoot: root });
  }
  if (!context || context.scope.kind === 'unrestricted' || !hasMembershipGuard(c)) return dispatch(c, filename, root);
  const policy = selectedPolicy ?? loadSelectedGuardPolicy(process.env);
  if (policy instanceof Error) throw policy;
  const registry = createApp(filename, true);
  let membership: ReturnType<typeof commandMembership>;
  try { membership = commandMembership(c, registry, context, policy); } finally { registry.close(); }
  let data = await dispatch(membership.command, filename, root);
  if (membership.listProjectIds) {
    const ids = membership.listProjectIds;
    if (c.name === 'project_list') {
      const result = data as { projects: { id: number }[] };
      data = { ...result, projects: result.projects.filter(p => ids.includes(p.id)) };
    } else if (c.name === 'request_list') {
      data = (data as { projectId: number | null }[]).filter(card => card.projectId !== null && ids.includes(card.projectId));
    }
  }
  if (!membership.warnings.length) return data;
  return { data, warnings: membership.warnings } satisfies GuardWarningResult;
}

async function dispatch(c: AppCommand, filename: string, root?: string): Promise<unknown> {
  if (c.name === 'policy_validate' || c.name === 'policy_explain') return executePolicyCommand(c);
  if (c.name === 'workspace_prepare' || c.name === 'workspace_inspect' || c.name === 'workspace_commit' || c.name === 'workspace_publish') {
    return executeWorkspaceOperation(c, filename);
  }
  if (c.name === 'home_status' || c.name === 'home_reconcile') {
    const writer = createHomeWriter(root ?? defaultContextRoot());
    return c.name === 'home_status' ? writer.status() : writer.reconcile();
  }
  if (c.name === 'db_init') { initializeState(filename); return { status: 'ok', database: filename }; }
  if (c.name === 'bootstrap') { initializeWorkspace(filename, root); return { status: 'ok' }; }
  if (c.name === 'backup') return backupState(filename, c.destination, root);
  if (c.name === 'restore') return restoreState(c.backupDirectory, filename, root);
  // DB-only operations must remain usable without context/Git, including a damaged home.
  if (c.name.startsWith('project_') || c.name.startsWith('status_')) {
    const app = createApp(filename, ['project_list', 'project_resolve', 'status_list'].includes(c.name));
    try {
      switch (c.name) {
        case 'project_list': return { projects: app.projects.list(c.org) };
        case 'project_add': return { project: app.projects.add(c.identity, c.code, c.checkoutPath) };
        case 'project_resolve': return app.projects.resolveCheckout(c.path);
        case 'status_list': return app.requests.statuses();
        case 'status_add': app.requests.addStatus(c.code, c.terminal); break;
        case 'status_rename': app.requests.renameStatus(c.code, c.newCode); break;
        case 'status_terminal': app.requests.setTerminal(c.code, c.terminal); break;
        case 'status_remove': app.requests.removeStatus(c.code); break;
        default: throw new InputError('Unknown database command');
      }
      return { status: 'ok' };
    } finally { app.close(); }
  }
  if (!isManagedHomeCommand(c.name)) return dispatchWorkspace(c, filename, root);
  const home = realpathSync(root ?? defaultContextRoot());
  return createHomeWriter(home).run(c.name, writer => dispatchWorkspace(c, filename, home, writer));
}

// Genuinely synchronous: never wrap async dispatch in HomeWriter and release its
// lock before SQLite/file work finishes. Uncovered async operations stay above.
function dispatchWorkspace(c: AppCommand, filename: string, root?: string, writer?: HomeWriteScope): unknown {
  const app = createWorkspace(filename, reads.has(c.name), root, undefined, writer);
  try {
    switch (c.name) {
      case 'capture': return { path: app.capture(inputText(c.source)) };
      case 'note_add': return { path: app.note(c.title, inputText(c.body), contextScope(c.scope, app.projects)) };
      case 'error_add': return { path: app.error(c.project, c.text) };
      case 'warmup': return app.warmup(contextScope(c.scope, app.projects));
      case 'memory_show': return app.memory.show(contextScope(c.scope, app.projects));
      case 'memory_add': return { path: app.memory.add(c.text, contextScope(c.scope, app.projects)) };
      case 'memory_remove': return { removed: app.memory.remove(c.number, contextScope(c.scope, app.projects)) };
      case 'journal_add': return { commit: app.journal(resolveScope(c.scope, app.projects), c.text) };
      case 'journal_read': return app.history(c.scope === 'all' ? 'all' : resolveScope(c.scope, app.projects), {
        ...(c.from === undefined ? {} : { from: c.from }), ...(c.to === undefined ? {} : { to: c.to }),
        ...(c.eventType === undefined ? {} : { type: c.eventType }), ...(c.limit === undefined ? {} : { limit: c.limit }),
      });
      case 'request_create': return app.requests.create({
        title: c.title, status: c.status, slug: c.slug, source: inputText(c.source),
        ...(c.project == null ? {} : { project: c.project }),
        ...(c.adoptSource === undefined ? {} : { adoptSource: c.adoptSource }),
      });
      case 'request_list': return app.requests.list(c);
      case 'request_show': return app.requests.get(c.key);
      case 'request_status': return app.requests.change(c.key, { status: c.status }, c.reason);
      case 'request_title': return app.requests.change(c.key, { title: c.title }, c.reason);
      case 'request_touch': return app.requests.touch(c.key);
      case 'request_progress': return app.requests.progress(c.key, c.text, c.artifacts);
      case 'home_document_patch': return app.patchDocument(c.path, c.expected, c.text);
      case 'context_read': {
        const content = app.read(c.path);
        if (content === undefined) throw new InputError('Missing context file');
        return { path: c.path, text: content };
      }
      case 'context_commit': return { commit: app.complete(c.paths, c.message) };
      case 'context_restore': return { commit: app.restoreContext(c.path, c.revision) };
      default: throw new InputError('Unknown workspace command');
    }
  } finally { app.close(); }
}
