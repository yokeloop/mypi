import { PartialError } from '../shared/context.js';
import type { ContextFiles } from '../shared/context.js';
import { InputError } from '../shared/errors.js';
import type { createApp } from './create-app.js';
import type { createJournal, sqliteJournalStore } from '../modules/knowledge/public.js';
import type { Card } from '../modules/tasks/public.js';
import { fileFingerprint, matchesFingerprint } from './file-fingerprints.js';

export function taskWork(core: ReturnType<typeof createApp>, files: ContextFiles & { path(path: string): string },
  store: ReturnType<typeof sqliteJournalStore>, journal: ReturnType<typeof createJournal>,
  key: (card: Card) => string, clock: () => string) {
  function find(publicKey: string): Card {
    const result = core.tasks.list().find(card => key(card) === publicKey);
    if (!result) throw new InputError('Unknown task key');
    return result;
  }
  function register(path: string): void {
    const current = fileFingerprint(files, path, clock()), saved = store.fingerprint(path);
    if (saved) matchesFingerprint(saved, current);
    else store.saveFingerprint(current);
  }
  return {
    get: find,
    list(options: { project?: string | undefined; status?: string | undefined } = {}) {
      const scope = options.project === undefined ? undefined : core.projects.resolveScope(options.project);
      if (scope && scope.type !== 'project') throw new InputError('Project identity required');
      if (options.status !== undefined && !core.tasks.statuses().some(s => s.code === options.status)) throw new InputError('Unknown status');
      return core.tasks.list().filter(c => (!scope || (scope.type === 'project' && c.projectId === scope.project.id))
        && (options.status === undefined || c.status === options.status)).map(card => ({ ...card, key: key(card) }));
    },
    create(input: { project: string; title: string; status: string; slug: string; source: string; adoptSource?: boolean }) {
      if (typeof input.source !== 'string') throw new InputError('Source text required');
      if (typeof input.project !== 'string') throw new InputError('Project identity required');
      const scope = core.projects.resolveScope(input.project);
      if (scope.type !== 'project') throw new InputError('Project identity required');
      const project = scope.project;
      let path: string | undefined, saved = false;
      try {
        const card = core.serialize(() => {
          const result = core.tasks.create({ projectId: project.id, slug: input.slug, title: input.title, status: input.status }, dir => {
            path = dir + '/source.md';
            if (input.adoptSource) {
              if (files.read(path) !== input.source) throw new InputError('Existing source differs/missing; inspect before adoption');
            } else files.create(path, input.source);
            saved = true;
          });
          register(result.contextDir + '/source.md');
          journal.append(journal.record({ type: 'task', key: key(result) }, 'Task registered.', 'task_created'));
          return result;
        });
        return { ...card, key: key(card) };
      } catch (e) {
        if (path) throw new PartialError(String(e), saved ? ['source'] : [], ['inspect source', 'database', 'journal'], [path]);
        throw e;
      }
    },
    change(publicKey: string, input: { status?: string; title?: string }, reason: string) {
      const card = find(publicKey);
      return core.serialize(() => {
        const result = core.tasks.change(card.id, input, reason);
        if (!result.changed) return result.after;
        const statusChanged = result.before.statusId !== result.after.statusId;
        const parts = [];
        if (statusChanged) parts.push(result.before.status + ' → ' + result.after.status);
        if (result.before.title !== result.after.title) parts.push('Title: ' + JSON.stringify(result.before.title) + ' → ' + JSON.stringify(result.after.title));
        journal.append(journal.record({ type: 'task', key: key(result.after) }, parts.join('. ') + '. ' + reason,
          statusChanged ? 'status_changed' : 'note'));
        return result.after;
      });
    },
    progress(publicKey: string, text: string, artifacts: { path: string; text?: string }[] = []) {
      const card = find(publicKey), entry = journal.record({ type: 'task', key: publicKey }, text, 'note');
      const paths = artifacts.map(a => card.contextDir + '/' + a.path);
      if (new Set(paths).size !== paths.length || artifacts.some(a => a.path === 'source.md')) throw new InputError('Invalid artifact set');
      if (paths.length) entry.artifacts = paths;
      const created: string[] = [];
      try {
        return core.serialize(() => {
          for (const [index, artifact] of artifacts.entries()) {
            const path = paths[index]!;
            if (artifact.text === undefined) {
              if (!store.fingerprint(path) && journal.published().has(path)) throw new InputError('Historical artifact requires explicit reconciliation');
            } else { files.create(path, artifact.text); created.push(path); }
            register(path);
          }
          journal.append(entry);
          return core.tasks.touch(card.id);
        });
      } catch (e) { throw new PartialError(String(e), created.length ? ['artifacts'] : [],
        ['inspect artifacts', 'journal', 'activity timestamp'], created.length ? created : [card.contextDir], card.id); }
    },
    touch(publicKey: string) { return core.tasks.touch(find(publicKey).id); },
  };
}
