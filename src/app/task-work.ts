import { PartialError } from '../shared/context.js';
import type { ContextFiles, ContextHistory } from '../shared/context.js';
import { InputError } from '../shared/errors.js';
import type { createApp } from './create-app.js';
import type { createJournal, sqliteJournalStore } from '../modules/knowledge/public.js';
import { pageTasks } from '../modules/tasks/public.js';
import type { Card } from '../modules/tasks/public.js';
import { isMilestone } from '../modules/events/public.js';
import { fileFingerprint, matchesFingerprint } from './file-fingerprints.js';

export function taskWork(core: ReturnType<typeof createApp>, files: ContextFiles & { path(path: string): string },
  store: ReturnType<typeof sqliteJournalStore>, journal: ReturnType<typeof createJournal>,
  history: Pick<ContextHistory, 'commit'>, key: (card: Card) => string, clock: () => string) {
  function find(publicKey: string): Card {
    const result = core.tasks.list().find(card => key(card) === publicKey);
    if (!result) throw new InputError('Unknown task key');
    return result;
  }
  function parents() { return new Map(core.tasks.list().map(card => [card.id, card])); }
  function view(card: Card, byId: Map<number, Card>) {
    return { ...card, parent: card.parentId === null ? null : key(byId.get(card.parentId)!) };
  }
  return {
    get: (publicKey: string) => view(find(publicKey), parents()),
    list(options: { project?: string | undefined; status?: string | undefined } = {}) {
      const scope = options.project === undefined ? undefined : core.projects.resolveScope(options.project);
      if (scope && scope.type !== 'project') throw new InputError('Project identity required');
      if (options.status !== undefined && !core.tasks.statuses().some(s => s.code === options.status)) throw new InputError('Unknown status');
      const cards = core.tasks.list(), byId = new Map(cards.map(card => [card.id, card]));
      return cards.filter(c => (!scope || (scope.type === 'project' && c.projectId === scope.project.id))
        && (options.status === undefined || c.status === options.status)).map(card => ({ ...view(card, byId), key: key(card) }));
    },
    page(options: { project?: string; status?: string; q?: string; before?: number; limit: number }) {
      let project = options.project;
      if (project !== undefined && /^[A-Z]+$/.test(project)) {
        const code = project, found = core.projects.list().find(p => p.code === code);
        if (!found) throw new InputError('Unknown project');
        project = found.org + '/' + found.slug;
      }
      return pageTasks(this.list({ project, status: options.status }), { q: options.q, before: options.before, limit: options.limit });
    },
    create(input: { project: string; title: string; status: string; slug: string; source: string; adoptSource?: boolean; parent?: string }) {
      if (typeof input.source !== 'string') throw new InputError('Source text required');
      if (typeof input.project !== 'string') throw new InputError('Project identity required');
      const scope = core.projects.resolveScope(input.project);
      if (scope.type !== 'project') throw new InputError('Project identity required');
      const project = scope.project;
      let path: string | undefined, saved = false;
      try {
        const parent = input.parent ?? null;
        const card = core.serialize(() => {
          const parentId = parent === null ? null : find(parent).id;
          const result = core.tasks.create({ projectId: project.id, slug: input.slug, title: input.title, status: input.status, parentId }, dir => {
            path = dir + '/source.md';
            if (input.adoptSource) {
              if (files.read(path) !== input.source) throw new InputError('Existing source differs/missing; inspect before adoption');
            } else files.create(path, input.source);
            saved = true;
          });
          journal.append(journal.record({ type: 'task', key: key(result) },
            parent === null ? 'Task registered.' : 'Task registered. Parent: ' + parent + '.', 'task_created'));
          return result;
        });
        return { ...card, key: key(card), parent };
      } catch (e) {
        if (path) throw new PartialError(String(e), saved ? ['source'] : [], ['inspect source', 'database', 'journal'], [path]);
        throw e;
      }
    },
    change(publicKey: string, input: { status?: string; title?: string }, reason: string, caller?: string) {
      const card = find(publicKey);
      return core.serialize(() => {
        const result = core.tasks.change(card.id, input, reason);
        if (!result.changed) {
          if (input.status !== undefined) journal.append(journal.record({ type: 'task', key: key(result.after) },
            result.after.status + ' (unchanged). ' + reason, 'note'));
          return result.after;
        }
        const statusChanged = result.before.statusId !== result.after.statusId;
        const titleChanged = result.before.title !== result.after.title;
        const parts = [];
        if (statusChanged) parts.push(result.before.status + ' → ' + result.after.status);
        if (titleChanged) parts.push('Title: ' + JSON.stringify(result.before.title) + ' → ' + JSON.stringify(result.after.title));
        const text = parts.join('. ') + '. ' + reason;
        journal.append(journal.record({ type: 'task', key: key(result.after) }, text,
          statusChanged ? 'status_changed' : titleChanged ? 'title_changed' : 'note'));
        if (statusChanged && result.after.projectId !== null && isMilestone(result.after.status, result.after.isTerminal)) {
          const task = key(result.after);
          const to = core.events.milestoneRecipient(task);
          if (caller !== to) core.events.milestone({ from: task, to, message: text });
        }
        return result.after;
      });
    },
    setParent(publicKey: string, parent: string | null, reason: string) {
      const card = find(publicKey);
      return core.serialize(() => {
        const parentId = parent === null ? null : find(parent).id;
        const result = core.tasks.setParent(card.id, parentId, reason);
        const name = (id: number | null) => id === null ? 'none' : key(core.tasks.get(id));
        if (result.changed) journal.append(journal.record({ type: 'task', key: key(result.after) },
          'Parent: ' + name(result.before.parentId) + ' → ' + name(result.after.parentId) + '. ' + reason, 'note'));
        return view(result.after, parents());
      });
    },
    progress(publicKey: string, text: string, artifacts: { path: string; text?: string }[] = []) {
      const card = find(publicKey), entry = journal.record({ type: 'task', key: publicKey }, text, 'note');
      const paths = artifacts.map(a => card.contextDir + '/' + a.path);
      if (new Set(paths).size !== paths.length || artifacts.some(a => a.path === 'source.md')) throw new InputError('Invalid artifact set');
      const created: string[] = [];
      try {
        return core.serialize(() => {
          for (const [index, artifact] of artifacts.entries()) {
            const path = paths[index]!;
            if (journal.frozen().has(path)) {
              const saved = store.fingerprint(path);
              if (!saved || artifact.text !== undefined) throw new InputError('Historical artifact requires explicit reconciliation');
              matchesFingerprint(saved, fileFingerprint(files, path, clock()));
            } else if (artifact.text !== undefined) { files.create(path, artifact.text); created.push(path); }
            else if (!files.isFile(path)) throw new InputError('Missing referenced file');
          }
          if (paths.length) {
            const commit = history.commit(paths, 'Register artifacts of ' + publicKey);
            entry.artifacts = paths.map(path => ({ path, commit }));
          }
          journal.append(entry);
          return core.tasks.touch(card.id);
        });
      } catch (e) { throw new PartialError(String(e), created.length ? ['artifacts'] : [],
        ['inspect artifacts', 'git', 'journal', 'activity timestamp'], created.length ? created : [card.contextDir], card.id); }
    },
    touch(publicKey: string) { return core.tasks.touch(find(publicKey).id); },
  };
}
