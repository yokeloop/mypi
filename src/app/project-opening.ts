import type { createProjects } from '../modules/projects/public.js';
import type { VerifiedRepositoryBinding } from '../modules/projects/public.js';
import { InputError } from '../shared/errors.js';

export interface ProjectOpeningRegistry {
  projects: Pick<ReturnType<typeof createProjects>, 'list'>;
  repositories: { verify(input: { project: string; baseRoot: string; worktreeRoot: string }): VerifiedRepositoryBinding };
  worktrees(baseRoot: string): readonly { root: string | null }[];
}
export interface ProjectOpeningChoice { project: string; worktree: string; branch: string }
export type ProjectOpeningSelection =
  | { state: 'projects'; projects: string[]; message: string }
  | { state: 'choices'; choices: ProjectOpeningChoice[]; message: string }
  | { state: 'selected'; choice: ProjectOpeningChoice };

/** Read-only project and actual Git worktree selection. No worktree is created by opening a chat. */
export function selectProjectOpening(registry: ProjectOpeningRegistry, project?: string, worktree?: string): ProjectOpeningSelection {
  if (project !== undefined && !/^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(project))
    throw new InputError('Project must be an explicit org/project identity');
  if (worktree !== undefined && (!worktree.startsWith('/') || /[\x00-\x1f\x7f]/.test(worktree)))
    throw new InputError('Worktree must be an absolute path');
  if (worktree !== undefined && project === undefined) throw new InputError('Worktree requires an explicit org/project');
  const all = registry.projects.list();
  if (project === undefined) return { state: 'projects', projects: all.map(item => `${item.org}/${item.slug}`),
    message: 'Select a registered project before inspecting its existing worktrees.' };
  if (!all.some(item => `${item.org}/${item.slug}` === project)) throw new InputError('Unknown registered project');
  const choices: ProjectOpeningChoice[] = [];
  for (const item of all) {
    const identity = `${item.org}/${item.slug}`;
    if ((project !== undefined && identity !== project) || !item.checkoutPath) continue;
    for (const tree of registry.worktrees(item.checkoutPath)) {
      if (!tree.root || (worktree !== undefined && tree.root !== worktree)) continue;
      try {
        const binding = registry.repositories.verify({ project: identity, baseRoot: item.checkoutPath, worktreeRoot: tree.root });
        choices.push({ project: identity, worktree: binding.worktreeRoot, branch: binding.branch });
      } catch { /* Git evidence is not a selectable target. */ }
    }
  }
  if (worktree !== undefined && !choices.length) throw new InputError('Requested worktree is not Git-confirmed for the registered project');
  if (choices.length === 1 && project !== undefined && worktree !== undefined) return { state: 'selected', choice: choices[0]! };
  return { state: 'choices', choices, message: choices.length
    ? 'Select an explicit registered project and existing Git-confirmed worktree.'
    : 'No existing Git-confirmed worktree. Create one as a separate explicit operation before opening a chat.' };
}
