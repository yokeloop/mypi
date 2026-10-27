import type { AppCommand } from './commands.js';
import { createWorkspace, initializeWorkspace } from './create-workspace.js';
import { createApp, initializeState } from './create-app.js';
import { backupState, restoreState, publishBackup, restorePublishedBackup } from './backup.js';
import { defaultContextRoot } from './create-workspace.js';
import { inputText } from './input-text.js';
import { contextScope, resolveScope } from './resolve-scope.js';
import { InputError } from '../shared/errors.js';

const reads = new Set(['warmup', 'memory_show', 'journal_read', 'task_list', 'task_show', 'context_read']);
export async function executeCommand(c: AppCommand, filename: string, root?: string): Promise<unknown> {
  if (c.name === 'db_init') { initializeState(filename); return { status: 'ok', database: filename }; }
  if (c.name === 'bootstrap') { initializeWorkspace(filename, root); return { status: 'ok' }; }
  if (c.name === 'backup') return backupState(filename, c.destination, root);
  if (c.name === 'backup_publish') return publishBackup({ filename, ...(root === undefined ? {} : { root }),
    ...(c.selectedPaths === undefined ? {} : { selectedPaths: c.selectedPaths }),
    ...(c.dryRun === undefined ? {} : { dryRun: c.dryRun }) });
  if (c.name === 'restore') return restoreState(c.backupDirectory, filename, root);
  if (c.name === 'restore_published') return restorePublishedBackup({ filename, root: root ?? defaultContextRoot(),
    repository: c.repository, commit: c.commit });
  // DB-only operations must remain usable without context/Git, including a damaged home.
  if (c.name.startsWith('project_') || c.name.startsWith('status_')) {
    const app = createApp(filename, ['project_list', 'project_resolve', 'status_list'].includes(c.name));
    try {
      switch (c.name) {
        case 'project_list': return { projects: app.projects.list(c.org) };
        case 'project_add': return { project: app.projects.add(c.identity, c.code, c.checkoutPath) };
        case 'project_update': return { project: app.projects.updateCheckout(c.identity, c.expectedCheckoutPath, c.checkoutPath) };
        case 'project_resolve': return app.projects.resolveCheckout(c.path);
        case 'status_list': return app.tasks.statuses();
        case 'status_add': app.tasks.addStatus(c.code, c.terminal); break;
        case 'status_rename': app.tasks.renameStatus(c.code, c.newCode); break;
        case 'status_terminal': app.tasks.setTerminal(c.code, c.terminal); break;
        case 'status_remove': app.tasks.removeStatus(c.code); break;
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
      case 'memory_remove': return { removed: app.memory.remove(c.number, c.expectedRevision, contextScope(c.scope, app.projects)) };
      case 'journal_add': return { saved: app.journal(resolveScope(c.scope, app.projects), c.text) };
      case 'journal_import': return app.importJournal();
      case 'journal_read': return app.history(c.scope === 'all' ? 'all' : resolveScope(c.scope, app.projects), {
        ...(c.from === undefined ? {} : { from: c.from }), ...(c.to === undefined ? {} : { to: c.to }),
        ...(c.eventType === undefined ? {} : { type: c.eventType }), ...(c.limit === undefined ? {} : { limit: c.limit }),
      });
      case 'task_create': return app.tasks.create({
        title: c.title, status: c.status, slug: c.slug, source: inputText(c.source),
        project: c.project,
        ...(c.adoptSource === undefined ? {} : { adoptSource: c.adoptSource }),
      });
      case 'task_list': return app.tasks.list(c);
      case 'task_show': return app.tasks.get(c.key);
      case 'task_status': return app.tasks.change(c.key, { status: c.status }, c.reason);
      case 'task_title': return app.tasks.change(c.key, { title: c.title }, c.reason);
      case 'task_touch': return app.tasks.touch(c.key);
      case 'task_progress': return app.tasks.progress(c.key, c.text, c.artifacts);
      case 'context_read': {
        const content = app.read(c.path);
        if (content === undefined) throw new InputError('Missing context file');
        return { path: c.path, text: content };
      }
      case 'context_commit': return { commit: app.complete(c.paths, c.message) };
      case 'context_restore': return { commit: app.restoreContext(c.path, c.revision) };
      case 'home_migrate_tasks': return app.migrateTasks(Boolean(c.dryRun));
      default: throw new InputError('Unknown workspace command');
    }
  } finally { app.close(); }
}
