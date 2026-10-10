import { createApp } from './create-app.js';
import type { Installation } from './installation.js';
import { createRepositoryBindings } from './repository-bindings.js';
import { selectProjectOpening } from './project-opening.js';
import type { ProjectOpeningSelection } from './project-opening.js';
import { repositoryIdentityReader } from '../infrastructure/git/repository-identity.js';
import { launchPi } from './pi-terminal.js';
export { ObservedSessionConflict } from './pi-terminal.js';
import { inspectProjectPiPackages } from './project-pi-packages.js';

export function projectOpeningChoices(installation: Installation, project?: string, worktree?: string): ProjectOpeningSelection {
  const app = createApp(installation.database, true);
  try {
    return selectProjectOpening({ projects: app.projects,
      repositories: createRepositoryBindings(app.projects, installation.engineRoot),
      worktrees: repositoryIdentityReader().worktrees }, project, worktree);
  } finally { app.close(); }
}
export async function openProjectPi(installation: Installation, callerCwd: string, project: string, worktree: string,
  allowObservedSession = false) {
  const selection = projectOpeningChoices(installation, project, worktree);
  if (selection.state !== 'selected') return selection;
  inspectProjectPiPackages(selection.choice.worktree, installation.engineRoot, process.env);
  const receipt = await launchPi({ selection: { kind: 'project', project }, cwd: selection.choice.worktree,
    args: [], herdrTab: true, title: `${project} (${selection.choice.branch})`, allowObservedSession },
    { cwd: callerCwd, installation });
  return { state: 'submitted' as const, choice: selection.choice, receipt };
}
