import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { createApp } from './create-app.js';
import { noCloneError } from './warmup.js';
import { flowFile, readProjectFlow } from './project-flow.js';
import { contextFiles } from '../infrastructure/filesystem/context-files.js';
import { projectGit } from '../infrastructure/git/project-git.js';
import { DEFAULT_TASK_BRANCH, taskBranchName, validBranchName } from '../modules/projects/public.js';
import { InputError } from '../shared/errors.js';

export function openTaskWorktree(filename: string, root: string, key: string): { key: string; branch: string; worktreePath: string; created: boolean; createdBranch: boolean } {
  const app = createApp(filename, false);
  try {
    const { card, clone, project } = app.readSnapshot(() => {
      const match = /^([A-Z]+)-([1-9][0-9]*)$/.exec(key);
      if (!match) throw new InputError('Invalid task key: ' + key + '; use CODE-N (MP-12)');
      const number = Number(match[2]);
      const cards = app.tasks.list();
      if (match[1] === 'REQ') {
        if (cards.some(c => c.projectId === null && c.number === number)) {
          throw new InputError('Task ' + key + ' has no project; a worktree needs a task of a registered project');
        }
        throw new InputError('Unknown task: ' + key);
      }
      const project = app.projects.list().find(p => p.code === match[1]);
      const card = project && cards.find(c => c.projectId === project.id && c.number === number);
      if (!project || !card) throw new InputError('Unknown task: ' + key);
      if (project.checkoutPath === null) throw noCloneError(project);
      return { card, clone: project.checkoutPath, project };
    });
    const files = contextFiles(root);
    const { flow } = readProjectFlow(files, project);
    const name = basename(card.contextDir);
    const slug = name.slice(key.length + 1);
    const branch = taskBranchName(flow.taskBranch ?? DEFAULT_TASK_BRANCH, key, slug);
    if (!validBranchName(branch)) {
      throw new InputError('Invalid flow ' + files.path(flowFile(project)) + ': taskBranch gives an invalid branch name for ' + key + ': ' + branch);
    }
    const ref = 'refs/heads/' + branch;
    const expected = clone + '--' + name;
    const git = projectGit(clone);
    const all = git.worktrees();
    const known = all.find(w => w.path === card.worktreePath || w.path === expected);
    if (known) {
      if (known.prunable) {
        throw new InputError('Worktree ' + known.path + ' of ' + branch + ' is registered in Git but its directory is missing; run git -C '
          + clone + ' worktree prune, then retry');
      }
      const at = known.path;
      app.serialize(() => app.tasks.recordWorktree(card.id, at));
      return { key, branch: known.branch === null ? branch : known.branch.slice('refs/heads/'.length), worktreePath: at, created: false, createdBranch: false };
    }
    const entries = all.filter(w => w.branch === ref);
    const prunable = entries.find(w => w.prunable);
    if (prunable) {
      throw new InputError('Worktree ' + prunable.path + ' of ' + branch + ' is registered in Git but its directory is missing; run git -C '
        + clone + ' worktree prune, then retry');
    }
    if (entries.length > 0) throw new InputError('Branch ' + branch + ' is checked out in another worktree: ' + entries[0]!.path + '; free it there first');
    if (existsSync(expected)) throw new InputError('Worktree path exists and is not the worktree of ' + branch + ': ' + expected);
    let main: string | null = null;
    try {
      git.fetch();
      main = flow.integration ?? git.defaultBranch();
      if (main !== null) git.updateBranch(main);
    } catch (error) {
      throw new InputError('Integration branch ' + (main ?? flow.integration ?? 'origin/HEAD') + ' cannot be updated in ' + clone + ': ' + (error as Error).message);
    }
    if (main === null) {
      throw new InputError('Integration branch cannot be determined in ' + clone + ': origin/HEAD and origin/main are missing; set integration in '
        + files.path(flowFile(project)));
    }
    let createdBranch = false;
    if (git.hasRef(ref)) git.addWorktree(expected, branch, { existing: true });
    else if (git.hasRef('refs/remotes/origin/' + branch)) git.addWorktree(expected, branch, { track: 'origin/' + branch });
    else { git.addWorktree(expected, branch, { from: main }); createdBranch = true; }
    app.serialize(() => app.tasks.recordWorktree(card.id, expected));
    return { key, branch, worktreePath: expected, created: true, createdBranch };
  } finally { app.close(); }
}
