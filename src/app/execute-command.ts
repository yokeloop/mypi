import type { AppCommand } from './commands.js';
import type { TrustedExecutionContext } from './execution-context.js';
import { executePolicyCommand } from './policy-commands.js';
import { createWorkspace, initializeWorkspace } from './create-workspace.js';
import { createApp, initializeState } from './create-app.js';
import { backupState, restoreState } from './backup.js';
import { inputText } from './input-text.js';
import { contextScope, resolveScope } from './resolve-scope.js';
import { InputError } from '../shared/errors.js';

const reads = new Set(['warmup', 'memory_show', 'journal_read', 'request_list', 'request_show', 'context_read']);
// Context is an out-of-band trusted composition input, never part of AppCommand.
export async function executeCommand(c: AppCommand, filename: string, root?: string, context?: TrustedExecutionContext): Promise<unknown> {
  if (c.name === 'policy_validate' || c.name === 'policy_explain' || c.name === 'policy_preview') return executePolicyCommand(c, context);
  if (context !== undefined) throw new InputError('Scoped command dispatch unavailable until resource enforcement is implemented (MP-9)');
  // Legacy no-context operations below are UNPROTECTED, not implicitly unrestricted grants.
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
  const app = createWorkspace(filename, reads.has(c.name), root);
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
        ...(c.project === null ? {} : { project: c.project }),
        ...(c.adoptSource === undefined ? {} : { adoptSource: c.adoptSource }),
      });
      case 'request_list': return app.requests.list(c);
      case 'request_show': return app.requests.get(c.key);
      case 'request_status': return app.requests.change(c.key, { status: c.status }, c.reason);
      case 'request_title': return app.requests.change(c.key, { title: c.title }, c.reason);
      case 'request_touch': return app.requests.touch(c.key);
      case 'request_progress': return app.requests.progress(c.key, c.text, c.artifacts);
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
