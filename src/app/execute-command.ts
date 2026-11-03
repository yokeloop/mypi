import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppCommand, RunContext } from './commands.js';
import { createWorkspace, initializeWorkspace } from './create-workspace.js';
import { createApp, initializeState } from './create-app.js';
import { backupState, restoreState, publishBackup, restorePublishedBackup } from './backup.js';
import { defaultContextRoot } from './create-workspace.js';
import { inputText } from './input-text.js';
import { contextScope, resolveScope } from './resolve-scope.js';
import { InputError } from '../shared/errors.js';
import { readWarmup, warmupScope } from './warmup.js';
import { openTaskWorktree } from './task-worktree.js';
import { projectFlow } from './project-flow-command.js';
import { openSession } from './launcher.js';
import { callerKey, forgetSession, listSessions, registerSession, sessionKey, unregisterSession } from './sessions.js';
import { emitEvent, listEvents, readInbox, sendMessage, turnEnd } from './events.js';
import type { EventTransports } from './delivery.js';

function homeFolder(root: string | undefined, path: string): string | null {
  return existsSync(join(root ?? defaultContextRoot(), path)) ? path : null;
}

const reads = new Set(['memory_show', 'journal_read', 'journal_page', 'task_list', 'task_page', 'task_show', 'context_read']);
export async function executeCommand(c: AppCommand, filename: string, root?: string,
  transports: EventTransports = {}, context: RunContext = {}): Promise<unknown> {
  if (c.name === 'db_init') { initializeState(filename); return { status: 'ok', database: filename }; }
  if (c.name === 'bootstrap') { initializeWorkspace(filename, root); return { status: 'ok' }; }
  if (c.name === 'backup') return backupState(filename, c.destination, root);
  if (c.name === 'backup_publish') return publishBackup({ filename, ...(root === undefined ? {} : { root }),
    ...(c.selectedPaths === undefined ? {} : { selectedPaths: c.selectedPaths }),
    ...(c.dryRun === undefined ? {} : { dryRun: c.dryRun }) });
  if (c.name === 'restore') return restoreState(c.backupDirectory, filename, root);
  if (c.name === 'restore_published') return restorePublishedBackup({ filename, root: root ?? defaultContextRoot(),
    repository: c.repository, commit: c.commit });
  if (c.name === 'warmup') return readWarmup(filename, root ?? defaultContextRoot(),
    warmupScope(c.scope, c.envScope, c.scope === undefined && c.session !== undefined ? sessionKey(filename, c.session) : undefined), c.maxChars);
  if (c.name === 'task_worktree') return openTaskWorktree(filename, root ?? defaultContextRoot(), c.key);
  if (c.name === 'open_session') return openSession(filename, root ?? defaultContextRoot(), c, transports, undefined, undefined, context);
  if (c.name === 'session_register') return registerSession(filename, c);
  if (c.name === 'session_unregister') return unregisterSession(filename, c);
  if (c.name === 'session_forget') return forgetSession(filename, c);
  if (c.name === 'sessions') return listSessions(filename, c);
  if (c.name === 'event_emit') return emitEvent(filename, c, transports);
  if (c.name === 'turn_end') return turnEnd(filename, c, transports);
  if (c.name === 'inbox') return readInbox(filename, c);
  if (c.name === 'event_list') return listEvents(filename, c);
  if (c.name === 'message_send') return sendMessage(filename, c, transports);
  if (c.name === 'project_flow') return projectFlow(filename, root ?? defaultContextRoot(), c.project);
  // DB-only operations must remain usable without context/Git, including a damaged home.
  if (c.name.startsWith('project_') || c.name.startsWith('status_') || c.name === 'org_remove') {
    const app = createApp(filename, ['project_list', 'project_resolve', 'status_list'].includes(c.name));
    try {
      switch (c.name) {
        case 'project_list': return { projects: app.projects.list(c.org) };
        case 'project_add': return { project: app.projects.add(c.identity, c.code, c.checkoutPath, c.repository) };
        case 'project_update': return { project: app.projects.update(c.identity, {
          ...(c.checkoutPath === undefined ? {} : { checkout: { expected: c.expectedCheckoutPath ?? null, path: c.checkoutPath } }),
          ...(c.repository === undefined ? {} : { repository: { expected: c.expectedRepository ?? null, value: c.repository } }),
        }) };
        case 'project_resolve': return app.projects.resolveCheckout(c.path);
        case 'project_remove': {
          const project = app.projects.remove(c.identity, c.expectedCode);
          return { removed: { project }, homeFolder: homeFolder(root, 'projects/' + project.org + '/' + project.slug) };
        }
        case 'org_remove': {
          const organization = app.projects.removeOrganization(c.org);
          return { removed: { organization }, homeFolder: homeFolder(root, 'projects/' + organization) };
        }
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
      case 'memory_show': return app.memory.show(contextScope(c.scope, app.projects));
      case 'memory_add': return { path: app.memory.add(c.text, contextScope(c.scope, app.projects)) };
      case 'memory_remove': return { removed: app.memory.remove(c.number, c.expectedRevision, contextScope(c.scope, app.projects)) };
      case 'journal_add': return { saved: app.journal(resolveScope(c.scope, app.projects), c.text) };
      case 'journal_import': return app.importJournal();
      case 'journal_read': return app.history(c.scope === 'all' ? 'all' : resolveScope(c.scope, app.projects), {
        ...(c.from === undefined ? {} : { from: c.from }), ...(c.to === undefined ? {} : { to: c.to }),
        ...(c.eventType === undefined ? {} : { type: c.eventType }), ...(c.limit === undefined ? {} : { limit: c.limit }),
      });
      case 'journal_page': return app.historyPage(c.scope === 'all' ? 'all' : resolveScope(c.scope, app.projects), {
        ...(c.from === undefined ? {} : { from: c.from }), ...(c.to === undefined ? {} : { to: c.to }),
        ...(c.eventType === undefined ? {} : { type: c.eventType }), ...(c.q === undefined ? {} : { q: c.q }),
        ...(c.before === undefined ? {} : { before: c.before }), limit: c.limit });
      case 'task_create': return app.tasks.create({
        title: c.title, status: c.status, slug: c.slug, source: inputText(c.source),
        project: c.project,
        ...(c.adoptSource === undefined ? {} : { adoptSource: c.adoptSource }),
      });
      case 'task_list': return app.tasks.list(c);
      case 'task_page': return app.tasks.page(c);
      case 'task_show': return app.tasks.get(c.key);
      case 'task_status': return app.tasks.change(c.key, { status: c.status }, c.reason, callerKey(filename, c));
      case 'task_title': return app.tasks.change(c.key, { title: c.title }, c.reason);
      case 'task_touch': return app.tasks.touch(c.key);
      case 'task_progress': return app.tasks.progress(c.key, c.text, c.artifacts);
      case 'context_read': {
        if (c.revision !== undefined) return { path: c.path, revision: c.revision, text: app.readVersion(c.path, c.revision) };
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
