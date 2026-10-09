import { PartialError } from '../shared/context.js';
import type { ContextFiles, ContextHistory } from '../shared/context.js';
import { InputError } from '../shared/errors.js';
import type { createApp } from './create-app.js';
import type { createJournal } from '../modules/knowledge/public.js';
import type { Card } from '../modules/requests/public.js';
import { changeContext } from './context-changes.js';
import type { HomeWriteScope } from '../shared/home-writer.js';

export function requestWork(core: ReturnType<typeof createApp>, files: ContextFiles, history: ContextHistory,
  journal: ReturnType<typeof createJournal>, key: (card: Card) => string, writer?: HomeWriteScope,
  clock = () => new Date().toISOString()) {
  function find(publicKey: string): Card {
    const result = core.requests.list().find(card => key(card) === publicKey);
    if (!result) throw new InputError('Unknown request key');
    return result;
  }
  function record(card: Card, text: string, type: 'note' | 'request_created' | 'status_changed', extra: string[] = []) {
    const entry = journal.record({ type: 'request', key: key(card) }, text, type, extra);
    const path = 'journal/' + entry.at.slice(0, 7) + '.jsonl';
    return core.serialize(() => changeContext(history, [path, ...extra], () => { journal.append(entry); }, text));
  }
  return {
    get: find,
    list(options: { project?: string | undefined; status?: string | undefined } = {}) {
      const scope = options.project === undefined ? undefined : core.projects.resolveScope(options.project);
      if (scope && scope.type !== 'project') throw new InputError('Project identity required');
      if (options.status !== undefined && !core.requests.statuses().some(s => s.code === options.status)) throw new InputError('Unknown status');
      return core.requests.list().filter(c => (!scope || (scope.type === 'project' && c.projectId === scope.project.id))
        && (options.status === undefined || c.status === options.status)).map(card => ({ ...card, key: key(card) }));
    },
    create(input: { project?: string; title: string; status: string; slug: string; source: string; adoptSource?: boolean }) {
      if (typeof input.source !== 'string') throw new InputError('Source text required');
      let project = null;
      if (input.project !== undefined) {
        const scope = core.projects.resolveScope(input.project);
        if (scope.type !== 'project') throw new InputError('Project identity required');
        project = scope.project;
      }
      let path: string | undefined, saved = false;
      let card: Card;
      try {
        card = core.requests.create({
          projectId: project?.id ?? null,
          slug: input.slug, title: input.title, status: input.status,
        }, dir => {
          path = dir + '/source.md';
          if (input.adoptSource) {
            if (files.read(path) !== input.source) throw new InputError('Existing source differs/missing; inspect before adoption');
          } else { history.clean([path]); }
          if (writer) {
            const log = 'journal/' + clock().slice(0, 7) + '.jsonl';
            history.clean([log]); history.validate([path]);
            writer.declare([{ path, expected: input.adoptSource ? writer.preimage(path) : null, ...(input.adoptSource ? { adopt: true as const } : {}) },
              { path: log, expected: writer.preimage(log) }]);
            writer.beforeEffect();
          }
          if (!input.adoptSource) files.create(path, input.source);
          saved = true;
        });
      } catch (e) {
        if (path) throw new PartialError(String(e), saved ? ['source'] : [], ['inspect source', 'database', 'journal', 'git'], [path]);
        throw e;
      }
      writer?.databaseSaved(card.id);
      try {
        // source was deliberately created outside Git, so publish it explicitly with the event.
        const entry = journal.record({ type: 'request', key: key(card) }, 'Request registered.', 'request_created');
        const log = 'journal/' + entry.at.slice(0, 7) + '.jsonl';
        core.serialize(() => {
          history.clean([log]);
          journal.append(entry);
          history.commit([card.contextDir + '/source.md', log], 'Register ' + key(card));
        });
      } catch (e) { throw new PartialError(String(e), ['source', 'database'], ['inspect journal', 'git'], [card.contextDir], card.id); }
      return { ...card, key: key(card) };
    },
    change(publicKey: string, input: { status?: string; title?: string }, reason: string) {
      const card = find(publicKey);
      if (writer) {
        const path = 'journal/' + clock().slice(0, 7) + '.jsonl';
        writer.declare([{ path, expected: writer.preimage(path) }]);
        writer.beforeEffect();
      }
      const result = core.requests.change(card.id, input, reason);
      if (!result.changed) return result.after;
      writer?.databaseSaved(result.after.id);
      try {
        const statusChanged = result.before.statusId !== result.after.statusId;
        const parts = [];
        if (statusChanged) parts.push(result.before.status + ' → ' + result.after.status);
        if (result.before.title !== result.after.title) parts.push('Title: ' + JSON.stringify(result.before.title) + ' → ' + JSON.stringify(result.after.title));
        record(result.after, parts.join('. ') + '. ' + reason, statusChanged ? 'status_changed' : 'note');
      } catch (e) { throw new PartialError(String(e), ['database'], ['inspect journal', 'git'], [result.after.contextDir], result.after.id); }
      return result.after;
    },
    progress(publicKey: string, text: string, artifacts: { path: string; text?: string }[] = []) {
      const card = find(publicKey), entry = journal.record({ type: 'request', key: publicKey }, text, 'note');
      const paths = artifacts.map(a => card.contextDir + '/' + a.path);
      if (new Set(paths).size !== paths.length || artifacts.some(a => a.path === 'source.md')) throw new InputError('Invalid artifact set');
      if (paths.length) entry.artifacts = paths;
      const log = 'journal/' + entry.at.slice(0, 7) + '.jsonl';
      let committed = false;
      try {
        core.serialize(() => {
          history.clean([log]);
          history.validate(paths);
          if (writer) {
            for (const [index, a] of artifacts.entries()) {
              if (a.text === undefined && !files.isFile(paths[index]!)) throw new InputError('Missing referenced artifact');
            }
            writer.declare([{ path: log, expected: writer.preimage(log) }, ...paths.map((path, index) => ({
              path, expected: artifacts[index]!.text === undefined ? writer.preimage(path) : null,
              ...(artifacts[index]!.text === undefined ? { adopt: true as const } : {}),
            }))]);
            writer.beforeEffect();
          }
          for (const [index, a] of artifacts.entries()) {
            if (a.text === undefined && !files.isFile(paths[index]!)) throw new InputError('Missing referenced artifact');
            if (a.text !== undefined) files.create(paths[index]!, a.text);
          }
          journal.append(entry);
          history.commit([log, ...paths], 'Progress ' + publicKey);
        });
        committed = true;
        const result = core.requests.touch(card.id);
        writer?.databaseSaved(card.id);
        return result;
      } catch (e) { throw new PartialError(String(e), committed ? ['artifacts', 'journal', 'git'] : [],
        committed ? ['activity timestamp'] : ['inspect artifacts/journal/git', 'activity timestamp'], [card.contextDir], card.id); }
    },
    touch(publicKey: string) { return core.requests.touch(find(publicKey).id); },
  };
}
