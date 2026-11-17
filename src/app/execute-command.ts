import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppCommand, OperationName, RunContext } from './commands.js';
import { createWorkspace, initializeWorkspace } from './create-workspace.js';
import { initializeState } from './create-app.js';
import { backupState, restoreState, publishBackup, restorePublishedBackup } from './backup.js';
import { defaultContextRoot } from './create-workspace.js';
import { inputText } from './input-text.js';
import { contextScope, resolveScope } from './resolve-scope.js';
import { InputError } from '../shared/errors.js';
import { readWarmup, warmupScope } from './warmup.js';
import { openTaskWorktree } from './task-worktree.js';
import { projectGit } from '../infrastructure/git/project-git.js';
import { projectFlow } from './project-flow-command.js';
import { openSession } from './launcher.js';
import { forgetSession, listSessions, otherLiveSession, promptSession, registerSession, sessionKey, unregisterSession } from './sessions.js';
import { archiveStatus, captureArchive, forgetArchive, importArchive, searchArchive, showArchive } from './archive.js';
import { emitEvent, readInbox, sendMessage, turnEnd } from './events.js';
import type { EventTransports } from './delivery.js';
import { localBackend } from './backend.js';
import type { Backend } from './backend.js';
import { isOperation, OPERATION_NAMES } from './operations.js';
import { isRemoteHome, REMOTE_HOME_COMMANDS, runRemoteHome } from './remote-home.js';
import { canonicalAbsoluteDirectory, canonicalDirectory } from '../infrastructure/filesystem/paths.js';
import type { Project } from '../modules/projects/public.js';
import { createApiToken, listApiTokens, revokeApiToken } from './api-tokens.js';

function homeFolder(root: string | undefined, path: string): string | null {
  return existsSync(join(root ?? defaultContextRoot(), path)) ? path : null;
}

type OperationCommand = Extract<AppCommand, { name: OperationName }>;

function devicePaths(c: OperationCommand): OperationCommand {
  if (c.name === 'project_add' && c.checkoutPath !== undefined) return { ...c, checkoutPath: canonicalDirectory(c.checkoutPath) };
  if (c.name === 'project_update' && c.checkoutPath !== undefined) return { ...c, checkoutPath: canonicalAbsoluteDirectory(c.checkoutPath) };
  if (c.name === 'project_resolve') return { ...c, path: canonicalDirectory(c.path) };
  if (c.name === 'task_status' && c.session !== undefined) return { ...c, session: { agent: c.session.agent, nativeId: c.session.nativeId } } as OperationCommand;
  return c;
}

async function runCommandOperation(c: OperationCommand, backend: Backend, root: string | undefined): Promise<unknown> {
  const { name, ...input } = backend.remote ? devicePaths(c) : c;
  const result = await backend.run(name, input as never);
  if (name === 'project_remove') {
    const { removed } = result as { removed: { project: Project } };
    return { removed, homeFolder: homeFolder(root, 'projects/' + removed.project.org + '/' + removed.project.slug) };
  }
  if (name === 'org_remove') {
    const { removed } = result as { removed: { organization: string } };
    return { removed, homeFolder: homeFolder(root, 'projects/' + removed.organization) };
  }
  return result;
}

const reads = new Set(['journal_page', 'task_page', 'context_read']);
export async function executeCommand(c: AppCommand, filename: string, root?: string,
  transports: EventTransports = {}, context: RunContext = {}, backend: Backend = localBackend(filename, root)): Promise<unknown> {
  if (backend.remote && !OPERATION_NAMES.has(c.name) && c.name !== 'project_flow' && !REMOTE_HOME_COMMANDS.has(c.name)) throw new InputError(c.name + ' is not available in remote mode');
  if (backend.remote && isRemoteHome(c)) return runRemoteHome(c, backend, root ?? defaultContextRoot());
  if (c.name === 'api_token_create') return createApiToken(c.file, c);
  if (c.name === 'api_token_list') return listApiTokens(c.file);
  if (c.name === 'api_token_revoke') return revokeApiToken(c.file, c.tokenName);
  if (c.name === 'db_init') { initializeState(filename); return { status: 'ok', database: filename }; }
  if (c.name === 'bootstrap') { initializeWorkspace(filename, root); return { status: 'ok' }; }
  if (c.name === 'backup') return backupState(filename, c.destination, root);
  if (c.name === 'backup_publish') return publishBackup({ filename, ...(root === undefined ? {} : { root }),
    ...(c.selectedPaths === undefined ? {} : { selectedPaths: c.selectedPaths }),
    ...(c.dryRun === undefined ? {} : { dryRun: c.dryRun }) });
  if (c.name === 'restore') return restoreState(c.backupDirectory, filename, root);
  if (c.name === 'restore_published') return restorePublishedBackup({ filename, root: root ?? defaultContextRoot(),
    repository: c.repository, commit: c.commit });
  if (c.name === 'warmup') {
    const key = warmupScope(c.scope, c.envScope, c.scope === undefined && c.session !== undefined ? sessionKey(filename, c.session) : undefined);
    const notice = c.caller === undefined ? undefined : otherLiveSession(filename, key, c.caller, c.session);
    return readWarmup(filename, root ?? defaultContextRoot(), key, c.maxChars, notice, c.session);
  }
  if (c.name === 'task_worktree') return openTaskWorktree(filename, root ?? defaultContextRoot(), c.key);
  if (c.name === 'open_session') return openSession(filename, root ?? defaultContextRoot(), c, transports, undefined, undefined, context);
  if (c.name === 'session_register') return registerSession(filename, c);
  if (c.name === 'session_prompt') return promptSession(filename, c, transports, undefined, (worktree, since) => projectGit(worktree).commitsSince(since));
  if (c.name === 'session_unregister') return unregisterSession(filename, c);
  if (c.name === 'session_forget') return forgetSession(filename, c);
  if (c.name === 'sessions') return listSessions(filename, c);
  if (c.name === 'archive_import') return importArchive(filename, c);
  if (c.name === 'archive_status') return archiveStatus(filename);
  if (c.name === 'archive_capture') return captureArchive(filename, c);
  if (c.name === 'archive_search') return searchArchive(filename, c);
  if (c.name === 'archive_show') return showArchive(filename, c);
  if (c.name === 'archive_forget') return forgetArchive(filename, c);
  if (c.name === 'event_emit') return emitEvent(filename, c, transports);
  if (c.name === 'turn_end') return turnEnd(filename, c, transports);
  if (c.name === 'inbox') return readInbox(filename, c);
  if (c.name === 'message_send') return sendMessage(filename, c, transports);
  if (c.name === 'project_flow') {
    const { projects } = await backend.run('project_list', {}) as { projects: Project[] };
    return projectFlow(projects, root ?? defaultContextRoot(), c.project);
  }
  if (isOperation(c.name) && c.name !== 'task_create' && c.name !== 'task_progress') return runCommandOperation(c as OperationCommand, backend, root);
  const app = createWorkspace(filename, reads.has(c.name), root);
  try {
    switch (c.name) {
      case 'capture': return { path: app.capture(inputText(c.source)) };
      case 'note_add': return { path: app.note(c.title, inputText(c.body), contextScope(c.scope, app.projects)) };
      case 'error_add': return { path: app.error(c.project, c.text) };
      case 'journal_import': return app.importJournal();
      case 'journal_page': return app.historyPage(c.scope === 'all' ? 'all' : resolveScope(c.scope, app.projects), {
        ...(c.from === undefined ? {} : { from: c.from }), ...(c.to === undefined ? {} : { to: c.to }),
        ...(c.eventType === undefined ? {} : { type: c.eventType }), ...(c.q === undefined ? {} : { q: c.q }),
        ...(c.before === undefined ? {} : { before: c.before }), limit: c.limit });
      case 'task_create': return app.tasks.create({
        title: c.title, status: c.status, slug: c.slug, source: inputText(c.source),
        project: c.project,
        ...(c.adoptSource === undefined ? {} : { adoptSource: c.adoptSource }),
        ...(c.parent === undefined ? {} : { parent: c.parent }),
      });
      case 'task_page': return app.tasks.page(c);
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
