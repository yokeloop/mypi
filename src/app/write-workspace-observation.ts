import { dirname } from 'node:path';
import { repositoryIdentityReader } from '../infrastructure/git/repository-identity.js';
import type { RepositoryEvidence, WorktreeEvidence } from '../modules/projects/public.js';
import { InputError } from '../shared/errors.js';
import type { WriteWorkspaceObservation } from './native-write-guard.js';

function listed(repository: RepositoryEvidence, entries: readonly WorktreeEvidence[]): boolean {
  const matches = entries.filter(entry => entry.root === repository.root);
  const entry = matches[0];
  return matches.length === 1 && !!entry && !entry.bare && !entry.detached && !entry.locked && !entry.prunable
    && entry.branch === repository.branch && entry.head === repository.head;
}

/** Local Git observation only. MP-8 selection carries project association; this does not infer it from a path. */
export function observeWriteWorkspace(root: string): WriteWorkspaceObservation {
  const reader = repositoryIdentityReader();
  const selected = reader.inspect(root);
  // This is only a candidate location: actual primary metadata and membership must confirm it.
  const base = selected.primary ? selected : reader.inspect(dirname(selected.commonDir));
  const entries = reader.worktrees(base.root);
  if (selected.bare || base.bare || !selected.branch || !base.branch || !base.primary
    || base.gitDir !== base.commonDir || selected.commonDir !== base.commonDir
    || !listed(selected, entries) || !listed(base, entries)) {
    throw new InputError('Selected worktree observation unavailable');
  }
  return { selectedRoot: selected.root, baseRoot: base.root, selectedIsBase: selected.root === base.root };
}
