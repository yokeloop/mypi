import { isAbsolute } from 'node:path';
import { InputError } from '../shared/errors.js';
import type { Backend } from './backend.js';
import { isDeviceBackend, toStoredPath } from './device-paths.js';
import type { Project } from '../modules/projects/public.js';

export async function relativizePaths(backend: Backend, apply: boolean) {
  if (!isDeviceBackend(backend)) throw new InputError('project relativize runs only from the mypi CLI of a device');
  const { raw, root } = backend;
  const { projects } = await raw.run('project_list', {}) as { projects: Project[] };
  const cards = await raw.run('task_list', {}) as { key: string; worktreePath: string | null }[];
  const planned = (from: string | null) => from !== null && isAbsolute(from) && toStoredPath(from, root) !== from;
  const projectPlan = projects.filter(p => planned(p.checkoutPath))
    .map(p => ({ identity: p.org + '/' + p.slug, from: p.checkoutPath!, to: toStoredPath(p.checkoutPath!, root) }));
  const worktreePlan = cards.filter(c => planned(c.worktreePath))
    .map(c => ({ key: c.key, from: c.worktreePath!, to: toStoredPath(c.worktreePath!, root) }));
  if (apply) {
    for (const p of projectPlan) await raw.run('project_update', { identity: p.identity, expectedCheckoutPath: p.from, checkoutPath: p.to });
    for (const w of worktreePlan) await raw.run('worktree_record', { key: w.key, worktreePath: w.to });
  }
  return { applied: apply, projects: projectPlan, worktrees: worktreePlan };
}
