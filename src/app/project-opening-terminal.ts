import { createApp } from './create-app.js';
import type { Installation } from './installation.js';
import { createRepositoryBindings } from './repository-bindings.js';
import { selectOrganizationOpening, selectProjectOpening } from './project-opening.js';
import type { ProjectOpeningSelection } from './project-opening.js';
import { repositoryIdentityReader } from '../infrastructure/git/repository-identity.js';
import { launchPi } from './pi-terminal.js';
export { ObservedSessionConflict } from './pi-terminal.js';
import { inspectProjectPiPackages } from './project-pi-packages.js';
import { canonicalDirectory } from '../infrastructure/filesystem/paths.js';
import { InputError } from '../shared/errors.js';

export function projectOpeningChoices(installation: Installation, project?: string, worktree?: string): ProjectOpeningSelection {
  const app = createApp(installation.database, true);
  try {
    return selectProjectOpening({ projects: app.projects,
      repositories: createRepositoryBindings(app.projects, installation.engineRoot),
      worktrees: repositoryIdentityReader().worktrees }, project, worktree);
  } finally { app.close(); }
}
export function organizationOpeningChoice(installation: Installation, organization: string) {
  const app = createApp(installation.database, true);
  try { return selectOrganizationOpening({ projects: app.projects,
    repositories: createRepositoryBindings(app.projects, installation.engineRoot),
    worktrees: repositoryIdentityReader().worktrees }, organization); }
  finally { app.close(); }
}
export async function openProjectPi(installation: Installation, callerCwd: string, project: string, worktree?: string,
  allowObservedSession = false) {
  const app = createApp(installation.database, true);
  let target: string;
  try {
    const registered = app.projects.list().find(item => `${item.org}/${item.slug}` === project);
    if (!registered) throw new InputError('Unknown registered project');
    if (!registered.checkoutPath && worktree === undefined) throw new InputError('Project has no registered checkout; register an existing base checkout first');
    target = worktree ?? registered.checkoutPath!;
  } finally { app.close(); }
  try { canonicalDirectory(target); }
  catch { throw new InputError('Project checkout/worktree directory is missing or invalid; register an existing checkout or choose an existing worktree'); }
  const selection = projectOpeningChoices(installation, project, target);
  if (selection.state !== 'selected') throw new InputError('Requested project checkout is not Git-confirmed');
  inspectProjectPiPackages(selection.choice.worktree, installation.engineRoot, process.env);
  const receipt = await launchPi({ selection: { kind: 'project', project }, cwd: selection.choice.worktree,
    args: [], herdrTab: true, title: `${project} (${selection.choice.branch})`, allowObservedSession },
    { cwd: callerCwd, installation });
  if (!('status' in receipt)) throw new InputError('Herdr launch returned no tab submission; inspect target before retrying');
  return { state: 'submitted' as const, choice: selection.choice, receipt };
}
export async function openOrganizationPi(installation: Installation, callerCwd: string, organization: string,
  allowObservedSession = false) {
  organizationOpeningChoice(installation, organization);
  let cwd: string;
  try { cwd = canonicalDirectory(callerCwd); }
  catch { throw new InputError('Organization opening requires an existing caller cwd; start Pi in a valid directory'); }
  inspectProjectPiPackages(cwd, installation.engineRoot, process.env);
  const receipt = await launchPi({ selection: { kind: 'organization', organization }, cwd,
    args: [], herdrTab: true, title: `${organization} (organization)`, allowObservedSession },
    { cwd: callerCwd, installation });
  if (!('status' in receipt)) throw new InputError('Herdr launch returned no tab submission; inspect target before retrying');
  return { state: 'submitted' as const, organization, cwd, receipt };
}
