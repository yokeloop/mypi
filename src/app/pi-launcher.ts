import { canonicalDirectory } from '../infrastructure/filesystem/paths.js';
import type { createProjects, VerifiedRepositoryBinding } from '../modules/projects/public.js';
import type { WorkScope } from '../modules/work-context/public.js';
import { InputError } from '../shared/errors.js';
import { parsePiContext } from './pi-context.js';
import type { PiContextData } from './pi-context.js';
import type { SessionList } from './session-cards.js';

export interface PiLaunchOptions {
  readonly selection?: WorkScope;
  readonly cwd?: string;
  readonly base?: string;
  readonly args: readonly string[];
  readonly allowObservedSession?: boolean;
  readonly herdrTab?: boolean;
  readonly title?: string;
}
export interface PiLaunchPlan {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly context?: PiContextData;
}
export interface PiLaunchRegistry {
  readonly projects: Pick<ReturnType<typeof createProjects>, 'resolveScope'>;
  readonly repositories: { verify(input: { project: string; baseRoot: string; worktreeRoot: string }): VerifiedRepositoryBinding };
}

/** Read-only selection. Concrete Git inspection is supplied only by the terminal composition. */
export function preparePiLaunch(options: PiLaunchOptions, currentCwd: string, registry?: PiLaunchRegistry): PiLaunchPlan {
  const scope = options.selection;
  if (options.base !== undefined && scope?.kind !== 'project') throw new InputError('--base requires --project');
  let cwd = options.cwd ?? currentCwd;
  let worktreeRoot: string | undefined;
  if (scope?.kind === 'project') {
    if (!registry) throw new InputError('Project registry required');
    const resolved = registry.projects.resolveScope(scope.project);
    if (resolved.type !== 'project') throw new InputError('Explicit registered project required');
    const baseRoot = options.base ?? resolved.project.checkoutPath;
    if (!baseRoot) throw new InputError('Project has no checkout; select an existing independent clone with --base');
    const binding = registry.repositories.verify({ project: scope.project, baseRoot, worktreeRoot: options.cwd ?? baseRoot });
    cwd = binding.worktreeRoot;
    worktreeRoot = binding.worktreeRoot;
  } else if (scope?.kind === 'organization') {
    if (!registry) throw new InputError('Project registry required');
    if (registry.projects.resolveScope(scope.organization).type !== 'org') throw new InputError('Explicit registered organization required');
  }
  cwd = canonicalDirectory(cwd);
  if (!scope) return { cwd, args: [...options.args] };
  const context = parsePiContext({ version: 1, cwd, context: { scope,
    ...(scope.kind === 'project' ? { selectedProject: scope.project, worktreeRoot } : {}),
  } });
  if (!context) throw new InputError('Invalid Pi working context');
  return { cwd, args: [...options.args], context };
}

/** Cache advice only. A missed card never proves exclusive use or process death. */
export function piLaunchObservations(cwd: string, inventory: SessionList, allowObservedSession = false,
  canonicalize: (directory: string) => string = canonicalDirectory) {
  const conflicts: { instanceKey: string; status: SessionList['sessions'][number]['status'] }[] = [];
  let incomplete = inventory.truncated || inventory.issues.length > 0;
  for (const view of inventory.sessions) {
    if (view.card.state === 'closed') continue;
    try {
      if (canonicalize(view.card.context?.worktreeRoot ?? view.card.cwd) === cwd) {
        conflicts.push({ instanceKey: view.card.instanceKey, status: view.status });
      }
    } catch { incomplete = true; }
  }
  return { conflicts, requiresChoice: conflicts.length > 0 && !allowObservedSession, incomplete };
}
