import { randomUUID } from 'node:crypto';
import { createMemory } from '../modules/memory/public.js';
import { createInbox } from '../modules/inbox/public.js';
import { warmup } from './warmup.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, initializeState } from './create-app.js';
import { contextFiles } from '../infrastructure/filesystem/context-files.js';
import { externalDatabasePath } from '../infrastructure/filesystem/paths.js';
import { contextGit } from '../infrastructure/git/context-git.js';
import { createJournal, createNotes } from '../modules/knowledge/public.js';
import { jsonlJournal } from '../modules/knowledge/adapters/jsonl-journal.js';
import { sameScope, scopeValue } from '../shared/scope.js';
import type { Scope } from '../shared/scope.js';
import type { Card } from '../modules/requests/public.js';
import { InputError } from '../shared/errors.js';
import { changeContext } from './context-changes.js';
import { requestWork } from './request-work.js';

export function defaultContextRoot(): string { return fileURLToPath(new URL('../../../home', import.meta.url)); }
export function initializeWorkspace(filename: string, root = defaultContextRoot()): void {
  externalDatabasePath(filename, root);
  initializeState(filename);
  contextGit(root).initialize();
}
export function createWorkspace(filename: string, readonly: boolean, root = defaultContextRoot(), clock = () => new Date().toISOString()) {
  externalDatabasePath(filename, root);
  const database = createApp(filename, readonly, clock), files = contextFiles(root);
  let published: ReadonlySet<string> = new Set();
  const git = contextGit(root, () => published);
  const core = { ...database, serialize<T>(work: () => T): T {
    return database.serialize(() => {
      git.validateJournal();
      const previous = published; published = journal.published();
      try { return work(); } finally { published = previous; }
    });
  } };
  function project(id: number) {
    const result = core.projects.list().find(p => p.id === id);
    if (!result) throw new InputError('Unknown parent project');
    return result;
  }
  function requestKey(card: Card): string { return (card.projectId === null ? 'REQ' : project(card.projectId).code) + '-' + card.number; }
  function resolve(scope: Scope): void {
    scopeValue(scope);
    if (scope.type === 'org') core.projects.resolveScope(scope.key);
    if (scope.type === 'project' && !core.projects.list().some(p => p.code === scope.key)) throw new InputError('Unknown project');
    if (scope.type === 'request' && !core.requests.list().some(r => requestKey(r) === scope.key)) throw new InputError('Unknown request');
  }
  function contains(filter: Scope, scope: Scope): boolean {
    if (sameScope(filter, scope)) return true;
    if (scope.type === 'request') {
      const card = core.requests.list().find(r => requestKey(r) === scope.key)!;
      if (card.projectId === null) return false;
      const p = project(card.projectId);
      return (filter.type === 'org' && filter.key === p.org) || (filter.type === 'project' && filter.key === p.code);
    }
    if (scope.type === 'project' && filter.type === 'org') return core.projects.list().some(p => p.code === scope.key && p.org === filter.key);
    return false;
  }
  const journal = createJournal(jsonlJournal(root), resolve, contains, clock);
  const requests = requestWork(core, files, git, journal, requestKey);
  function contextPath(scope?: string): string {
    const resolved = core.projects.resolveScope(scope);
    if (resolved.type === 'global') return '';
    return resolved.type === 'org' ? 'projects/' + resolved.slug : join('projects', resolved.project.org, resolved.project.slug);
  }
  const texts = {
    read: files.read, list: files.list,
    create(path: string, text: string) { core.serialize(() => changeContext(git, [path], () => files.create(path, text), 'Create ' + path)); },
    edit(path: string, update: (old: string | undefined) => string) {
      core.serialize(() => {
        const old = files.read(path), next = update(old);
        changeContext(git, [path], () => { if (old === undefined) files.create(path, next); else files.replace(path, next, old); }, 'Update ' + path);
      });
    },
  };
  const name = () => clock().replace(/:/g, '-') + '-' + randomUUID();
  const memory = createMemory(texts), inbox = createInbox(texts, name), notes = createNotes(texts, name, clock);
  return {
    projects: core.projects, close: core.close, requests, root,
    statuses: {
      statuses: core.requests.statuses, addStatus: core.requests.addStatus,
      renameStatus: core.requests.renameStatus, setTerminal: core.requests.setTerminal,
      removeStatus: core.requests.removeStatus,
    },
    history: journal.read,
    journal(scope: Scope, text: string) {
      const entry = journal.record(scope, text), path = 'journal/' + entry.at.slice(0, 7) + '.jsonl';
      return core.serialize(() => changeContext(git, [path], () => { journal.append(entry); }, text));
    },
    read: files.read,
    restoreContext(path: string, revision: string) { return core.serialize(() => git.restoreFile(path, revision)); },
    complete(paths: string[], message: string) {
      return core.serialize(() => git.commit(paths, message));
    },
    contextPath,
    memory: {
      show: (scope?: string) => memory.show(contextPath(scope)),
      add: (text: string, scope?: string) => memory.add(contextPath(scope), text),
      remove: (number: number, scope?: string) => memory.remove(contextPath(scope), number),
    },
    capture: inbox.capture,
    inbox: inbox.index,
    note: (title: string, text: string, scope?: string) => notes.note(contextPath(scope), title, text),
    error(scope: string, text: string) {
      if (core.projects.resolveScope(scope).type !== 'project') throw new InputError('Error log requires project scope');
      return notes.error(contextPath(scope), text);
    },
    warmup(scope?: string) {
      const resolved = core.projects.resolveScope(scope);
      return warmup(resolved, memory, inbox, files.read,
        resolved.type === 'org' ? core.projects.list(resolved.slug) : core.projects.list(), journal.read);
    },
  };
}
