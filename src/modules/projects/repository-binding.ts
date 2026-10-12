import { InputError } from '../../shared/errors.js';
import type { Project } from './model.js';
import type { RepositoryEvidence, WorktreeEvidence } from './ports.js';

export interface VerifiedRepositoryBinding {
  readonly project: string;
  readonly baseRoot: string;
  readonly commonDir: string;
  readonly worktreeRoot: string;
  /** Short local branch name, without refs/heads/. */
  readonly branch: string;
  readonly baseReadOnly: true;
}

const contains = (parent: string, child: string): boolean =>
  parent === child || child.startsWith(parent.replace(/\/$/, '') + '/');

/** Pure rules over trusted adapter evidence; this is neither ownership nor a write lease. */
export function bindRepositoryEvidence(input: {
  readonly project: Project;
  readonly base: RepositoryEvidence;
  readonly candidate: RepositoryEvidence;
  readonly installedEngine: RepositoryEvidence;
  readonly worktrees: readonly WorktreeEvidence[];
  readonly expectedBranch?: string;
}): VerifiedRepositoryBinding {
  const { project, base, candidate, installedEngine: installed, worktrees, expectedBranch } = input;
  const denied = (): never => { throw new InputError('Repository binding unavailable or mismatched'); };
  if (base.bare || candidate.bare || !base.primary || base.gitDir !== base.commonDir
    || candidate.commonDir !== base.commonDir || !base.branch || !candidate.branch
    || (expectedBranch !== undefined && candidate.branch !== expectedBranch)) denied();
  // Installation containment alone is not identity: independent nested clones are allowed.
  // Ancestor roots, shared metadata and any roots inside installed metadata are not.
  for (const root of [base.root, candidate.root, base.commonDir, candidate.gitDir]) {
    if (contains(root, installed.root) || contains(root, installed.commonDir)
      || contains(installed.commonDir, root)) denied();
  }
  const usable = (repository: RepositoryEvidence): boolean => {
    const matches = worktrees.filter(entry => entry.root === repository.root);
    const entry = matches[0];
    return matches.length === 1 && !!entry && !entry.bare && !entry.detached
      && !entry.prunable && !entry.locked && entry.branch === repository.branch && entry.head === repository.head;
  };
  if (!usable(base) || !usable(candidate)) denied();
  return Object.freeze({ project: `${project.org}/${project.slug}`, baseRoot: base.root,
    commonDir: base.commonDir, worktreeRoot: candidate.root, branch: candidate.branch!, baseReadOnly: true });
}
