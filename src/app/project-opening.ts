import { validSlug } from '../modules/projects/public.js';
import type { createProjects, VerifiedRepositoryBinding } from '../modules/projects/public.js';
import { InputError } from '../shared/errors.js';

export interface ProjectOpeningRegistry {
  projects: Pick<ReturnType<typeof createProjects>, 'list' | 'listOrganizations'>;
  repositories: { verify(input: { project: string; baseRoot: string; worktreeRoot: string }): VerifiedRepositoryBinding };
  worktrees(baseRoot: string): readonly { root: string | null }[];
}
export interface ProjectOpeningChoice { project: string; worktree: string; branch: string }
export type ProjectOpeningSelection =
  | { state: 'projects'; organizations: string[]; projects: string[]; message: string }
  | { state: 'choices'; choices: ProjectOpeningChoice[]; message: string }
  | { state: 'selected'; choice: ProjectOpeningChoice };

/** Read-only registry and Git selection; neither listing nor selection creates a worktree. */
export function selectProjectOpening(registry: ProjectOpeningRegistry, project?: string, worktree?: string): ProjectOpeningSelection {
  if (project !== undefined && (!project.split('/').every(validSlug) || project.split('/').length !== 2))
    throw new InputError('Project must be an explicit org/project identity');
  if (worktree !== undefined && (!worktree.startsWith('/') || /[\x00-\x1f\x7f]/.test(worktree)))
    throw new InputError('Worktree must be an absolute path');
  if (worktree !== undefined && project === undefined) throw new InputError('Worktree requires an explicit org/project');
  const all = registry.projects.list();
  if (project === undefined) return { state: 'projects', organizations: registry.projects.listOrganizations().map(item => item.slug),
    projects: all.map(item => `${item.org}/${item.slug}`), message: 'Select a registered organization or project.' };
  const item = all.find(item => `${item.org}/${item.slug}` === project);
  if (!item) throw new InputError('Unknown registered project');
  const choices: ProjectOpeningChoice[] = [];
  if (item.checkoutPath) {
    for (const tree of registry.worktrees(item.checkoutPath)) {
      if (!tree.root || (worktree !== undefined && tree.root !== worktree)) continue;
      try {
        const binding = registry.repositories.verify({ project, baseRoot: item.checkoutPath, worktreeRoot: tree.root });
        choices.push({ project, worktree: binding.worktreeRoot, branch: binding.branch });
      } catch { /* Git evidence is not a selectable target. */ }
    }
  }
  if (worktree !== undefined && !choices.length) throw new InputError('Requested worktree is not Git-confirmed for the registered project');
  if (worktree !== undefined) return { state: 'selected', choice: choices[0]! };
  return { state: 'choices', choices, message: choices.length
    ? 'Registered base checkout is the default; select an existing Git-confirmed worktree only if needed.'
    : 'No existing Git-confirmed checkout. Register a valid checkout before opening a project chat.' };
}

export function selectOrganizationOpening(registry: ProjectOpeningRegistry, organization: string): { state: 'organization'; organization: string } {
  if (!validSlug(organization)) throw new InputError('Organization must be a lowercase slug');
  if (!registry.projects.listOrganizations().some(item => item.slug === organization)) throw new InputError('Unknown registered organization');
  return { state: 'organization', organization };
}
