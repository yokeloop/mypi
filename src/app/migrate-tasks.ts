import { existsSync, lstatSync, readdirSync, rmdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PartialError } from '../shared/context.js';
import type { ContextFiles, ContextHistory } from '../shared/context.js';
import { InputError } from '../shared/errors.js';
import type { createApp } from './create-app.js';
import type { Card } from '../modules/tasks/public.js';

export interface TaskMove { from: string; to: string }
export interface TaskRewrite { key: string; from: string; to: string }
export type MigrateTasksResult = { status: 'preview' | 'ok'; commit?: string; moves: TaskMove[]; rewrites: TaskRewrite[] } | { status: 'noop' };
export function migrateTaskDirectories(core: Pick<ReturnType<typeof createApp>, 'tasks' | 'projects' | 'journalStore' | 'serialize'>,
  files: ContextFiles & { path(path: string): string }, git: ContextHistory, key: (card: Card) => string, dryRun: boolean): MigrateTasksResult {
  git.cleanAll();
  const dir = (p: string) => existsSync(files.path(p)) && lstatSync(files.path(p)).isDirectory();
  const moves: TaskMove[] = [], rewrites: TaskRewrite[] = [], ids: { id: number; from: string; to: string }[] = [];
  for (const card of core.tasks.list()) {
    const parent = card.projectId === null ? undefined : core.projects.list().find(p => p.id === card.projectId);
    const base = parent ? 'projects/' + parent.org + '/' + parent.slug + '/' : '';
    if (!card.contextDir.startsWith(base + 'requests/')) continue;
    const from = card.contextDir, to = base + 'tasks/' + card.contextDir.slice((base + 'requests/').length);
    const source = dir(from), target = dir(to);
    if (source && target) throw new InputError('Target directory exists: ' + to);
    if (!source && !target) throw new InputError('Task directory missing: ' + from);
    if (source) moves.push({ from, to });
    rewrites.push({ key: key(card), from, to });
    ids.push({ id: card.id, from, to });
  }
  if (dryRun) return { status: 'preview', moves, rewrites };
  if (!moves.length && !rewrites.length) return { status: 'noop' };
  const commit = moves.length ? git.moveDirectories(moves, 'Move task directories from requests/ to tasks/') : undefined;
  for (const parent of new Set(moves.map(move => dirname(move.from)))) {
    if (dir(parent) && readdirSync(files.path(parent)).length === 0) rmdirSync(files.path(parent));
  }
  try {
    core.serialize(() => {
      for (const r of ids) { core.tasks.relocate(r.id, r.to); core.journalStore.relocateFiles(r.from, r.to); }
    });
  } catch (e) { throw new PartialError(String(e), ['context'], ['database'], rewrites.map(r => r.to)); }
  return { status: 'ok', ...(commit === undefined ? {} : { commit }), moves, rewrites };
}
