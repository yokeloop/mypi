import type { AppCommand } from './commands.js';
import { createWorkspace, initializeWorkspace } from './create-workspace.js';
import { createApp, initializeState } from './create-app.js';
import { backupState, restoreState, publishBackup, restorePublishedBackup } from './backup.js';
import { defaultContextRoot } from './create-workspace.js';
import { inputText } from './input-text.js';
import { contextScope, resolveScope } from './resolve-scope.js';
import { InputError } from '../shared/errors.js';
import { createNativeWorkChats } from './create-native-work-chats.js';
import { dirname } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const reads = new Set(['warmup', 'memory_show', 'journal_read', 'request_list', 'request_show', 'context_read']);
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
  if (c.name.startsWith('work_chat_')) {
    const pi = process.env.MYPI_WORK_CHAT_PI, agentDir = process.env.PI_CODING_AGENT_DIR;
    if (!pi || !agentDir) throw new InputError('Set MYPI_WORK_CHAT_PI to the absolute target Pi executable and PI_CODING_AGENT_DIR to its configured resources');
    const installation = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
    const statePath = dirname(dirname(filename));
    const workspace = createWorkspace(filename, c.name !== 'work_chat_execute', root);
    try {
      const chats = createNativeWorkChats(workspace, { pi, nodePath: process.execPath,
        statePath, installation, agentDir });
      switch (c.name) {
        case 'work_chat_open': return await chats.previewOpen({ identity: c.identity, requestId: c.requestId,
          sourceClone: c.sourceClone, worktree: c.worktree, installation, statePath,
          ...(c.nameLabel === undefined ? {} : { name: c.nameLabel }), ...(c.model ? { model: c.model } : {}) });
        case 'work_chat_resume': return await chats.previewResume(c.id, c.model);
        case 'work_chat_new_empty': return await chats.previewNewEmpty(c.id, {
          ...(c.nameLabel === undefined ? {} : { name: c.nameLabel }), ...(c.model ? { model: c.model } : {}) });
        case 'work_chat_execute': {
          const result = await chats.execute(c.preview, c.focus);
          return result.outcome === 'partial' || result.outcome === 'blocked' ? { status: 'partial', ...result } : result;
        }
        case 'work_chat_list': return { chats: await chats.list() };
        case 'work_chat_show': return await chats.show(c.id);
      }
    } finally { workspace.close(); }
  }
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
      case 'memory_remove': return { removed: app.memory.remove(c.number, c.expectedRevision, contextScope(c.scope, app.projects)) };
      case 'journal_add': return { saved: app.journal(resolveScope(c.scope, app.projects), c.text) };
      case 'journal_import': return app.importJournal();
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
