import type { AppCommand } from './commands.js';
import type { Backend } from './backend.js';
import { deviceHome } from './create-workspace.js';
import { fileFingerprint, matchesFingerprint } from './file-fingerprints.js';
import { inputText } from './input-text.js';
import { contextFiles } from '../infrastructure/filesystem/context-files.js';
import type { FileFingerprint } from '../modules/knowledge/public.js';
import type { Card } from '../modules/tasks/public.js';
import { PartialError } from '../shared/context.js';
import { InputError } from '../shared/errors.js';

export const REMOTE_HOME_COMMANDS: ReadonlySet<string> = new Set(['task_create', 'task_progress', 'note_add', 'capture', 'error_add',
  'context_commit', 'context_restore', 'context_read']);
type HomeCommand = Extract<AppCommand, { name: 'task_create' | 'task_progress' | 'note_add' | 'capture' | 'error_add' | 'context_commit' | 'context_restore' | 'context_read' }>;

export function isRemoteHome(c: AppCommand): c is HomeCommand {
  return REMOTE_HOME_COMMANDS.has(c.name);
}

type Guard = { frozen: string[]; fingerprints: FileFingerprint[] };

async function guarded(backend: Backend, root: string, paths?: string[]) {
  const g = await backend.run('context_guard', paths === undefined ? {} : { paths }) as Guard;
  const frozen = new Set(g.frozen), fingerprints = new Map(g.fingerprints.map(f => [f.path, f]));
  return { ...deviceHome(root, frozen, fingerprints), frozen, fingerprints };
}

export async function runRemoteHome(c: HomeCommand, backend: Backend, root: string, clock = () => new Date().toISOString()): Promise<unknown> {
  switch (c.name) {
    case 'task_create': {
      if (c.adoptSource === true) throw new InputError('adopt-source is not available in remote mode');
      const source = inputText(c.source);
      const result = await backend.run('task_create', { project: c.project, title: c.title, status: c.status, slug: c.slug,
        ...(c.parent === undefined ? {} : { parent: c.parent }) }) as Card & { key: string; parent: string | null };
      const path = result.contextDir + '/source.md';
      try { contextFiles(root).create(path, source); } catch (e) {
        throw new PartialError(String(e), ['database', 'journal'], ['inspect source'], [path], result.id);
      }
      return result;
    }
    case 'task_progress': {
      const artifacts = c.artifacts ?? [];
      if (!artifacts.length) return backend.run('task_progress', { key: c.key, text: c.text });
      const card = await backend.run('task_show', { key: c.key }) as Card;
      const paths = artifacts.map(a => card.contextDir + '/' + a.path);
      if (new Set(paths).size !== paths.length || artifacts.some(a => a.path === 'source.md')) throw new InputError('Invalid artifact set');
      const home = await guarded(backend, root, paths);
      const created: string[] = [];
      let commit: string;
      try {
        for (const [index, artifact] of artifacts.entries()) {
          const path = paths[index]!;
          if (home.frozen.has(path)) {
            const saved = home.fingerprints.get(path);
            if (!saved || artifact.text !== undefined) throw new InputError('Historical artifact requires explicit reconciliation');
            matchesFingerprint(saved, fileFingerprint(home.files, path, clock()));
          } else if (artifact.text !== undefined) { home.files.create(path, artifact.text); created.push(path); }
          else if (!home.files.isFile(path)) throw new InputError('Missing referenced file');
        }
        commit = home.git.commit(paths, 'Register artifacts of ' + c.key);
      } catch (e) { throw new PartialError(String(e), created.length ? ['artifacts'] : [],
        ['inspect artifacts', 'git', 'journal', 'activity timestamp'], created.length ? created : [card.contextDir], card.id); }
      try { return await backend.run('task_progress', { key: c.key, text: c.text, artifacts: artifacts.map(a => a.path), commit }); }
      catch (e) { throw new PartialError(String(e), created.length ? ['artifacts', 'git'] : ['git'], ['journal', 'activity timestamp'], paths, card.id); }
    }
    case 'note_add': {
      const body = inputText(c.body);
      const { path: base } = await backend.run('context_base', { scope: c.scope }) as { path: string };
      const home = await guarded(backend, root);
      return { path: home.note(base, c.title, body) };
    }
    case 'capture': {
      const source = inputText(c.source);
      const home = await guarded(backend, root);
      return { path: home.capture(source) };
    }
    case 'error_add': {
      const { path: base } = await backend.run('context_base', { project: c.project }) as { path: string };
      const home = await guarded(backend, root);
      return { path: home.error(base, c.text) };
    }
    case 'context_commit': {
      const home = await guarded(backend, root, c.paths);
      return { commit: home.complete(c.paths, c.message) };
    }
    case 'context_restore': {
      const home = await guarded(backend, root);
      return { commit: home.restoreContext(c.path, c.revision) };
    }
    case 'context_read': {
      const home = deviceHome(root, new Set(), new Map());
      if (c.revision !== undefined) return { path: c.path, revision: c.revision, text: home.readVersion(c.path, c.revision) };
      const content = home.read(c.path);
      if (content === undefined) throw new InputError('Missing context file');
      return { path: c.path, text: content };
    }
  }
}
