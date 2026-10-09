import { createHash } from 'node:crypto';
import { repositoryIdentityReader } from '../infrastructure/git/repository-identity.js';
import { bindRepositoryEvidence } from '../modules/projects/public.js';
import type { createProjects, RepositoryIdentityReader, VerifiedRepositoryBinding } from '../modules/projects/public.js';
import { InputError } from '../shared/errors.js';

export interface RepositoryBinding extends VerifiedRepositoryBinding {
  /** Stable identity reference, not a bearer credential or proof of ownership. */
  readonly id: string;
}
export interface RepositoryBindingInput {
  readonly project: string;
  /** Explicit operator-selected independent clone; checkoutPath alone does not prove association. */
  readonly baseRoot: string;
  readonly worktreeRoot: string;
  /** Short local branch name, without refs/heads/. */
  readonly expectedBranch?: string;
}

/**
 * Separate Git inspection: never import this subprocess adapter through createApp
 * or policy parsing. The installation root comes from composition, not tool arguments.
 * All paths must already exist. Base bindings carry read-only guidance for consumers,
 * not filesystem permissions. Verification helps avoid selecting the wrong checkout.
 *
 * This observation is not ownership or OS isolation. Metadata and paths can change
 * after inspection; canonical paths do not detect hardlinks or bind mounts.
 */
export function createRepositoryBindings(
  projects: Pick<ReturnType<typeof createProjects>, 'resolveScope'>,
  trustedInstalledEngineRoot: string,
) {
  const reader: RepositoryIdentityReader = repositoryIdentityReader();
  return {
    verify(input: RepositoryBindingInput): RepositoryBinding {
      try {
        // Explicit registry lookup only; never resolveCheckout or checkoutPath containment.
        const scope = projects.resolveScope(input.project);
        if (scope.type !== 'project') throw new InputError('Explicit registered project required');
        const installedEngine = reader.inspect(trustedInstalledEngineRoot);
        const base = reader.inspect(input.baseRoot);
        const candidate = reader.inspect(input.worktreeRoot);
        const binding = bindRepositoryEvidence({ project: scope.project, installedEngine, base, candidate,
          worktrees: reader.worktrees(base.root),
          ...(input.expectedBranch === undefined ? {} : { expectedBranch: input.expectedBranch }) });
        const id = 'repository:sha256:' + createHash('sha256').update(JSON.stringify([
          binding.project, scope.project.id, binding.baseRoot, binding.commonDir, binding.worktreeRoot, binding.branch,
        ])).digest('hex');
        return Object.freeze({ ...binding, id });
      } catch {
        // Do not leak foreign registry identities, paths, Git configuration or stderr.
        throw new InputError('Repository binding unavailable or mismatched');
      }
    },
  };
}
