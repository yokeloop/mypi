import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { createApp } from './create-app.js';
import { noCloneError } from './warmup.js';
import { projectGit } from '../infrastructure/git/project-git.js';
import { InputError } from '../shared/errors.js';

export function openTaskWorktree(filename: string, key: string): { key: string; branch: string; worktreePath: string; created: boolean } {
  const app = createApp(filename, false);
  try {
    const { card, clone } = app.readSnapshot(() => {
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
      return { card, clone: project.checkoutPath };
    });
    const name = basename(card.contextDir);
    const branch = 'task/' + name;
    const ref = 'refs/heads/' + branch;
    const expected = clone + '--' + name;
    const git = projectGit(clone);
    const entries = git.worktrees().filter(w => w.branch === ref);
    const prunable = entries.find(w => w.prunable);
    if (prunable) {
      throw new InputError('Worktree ' + prunable.path + ' of ' + branch + ' is registered in Git but its directory is missing; run git -C '
        + clone + ' worktree prune, then retry');
    }
    const known = entries.find(w => w.path === card.worktreePath || w.path === expected);
    if (known) {
      const at = known.path;
      app.serialize(() => app.tasks.recordWorktree(card.id, at));
      return { key, branch, worktreePath: at, created: false };
    }
    if (entries.length > 0) throw new InputError('Branch ' + branch + ' is checked out in another worktree: ' + entries[0]!.path + '; free it there first');
    if (existsSync(expected)) throw new InputError('Worktree path exists and is not the worktree of ' + branch + ': ' + expected);
    let main: string | null;
    try {
      git.fetch();
      main = git.defaultBranch();
      if (main !== null) git.updateBranch(main);
    } catch (error) {
      throw new InputError('Main branch cannot be updated in ' + clone + ': ' + (error as Error).message);
    }
    if (main === null) throw new InputError('Main branch cannot be determined in ' + clone + ': origin/HEAD and origin/main are missing');
    if (git.hasRef(ref)) git.addWorktree(expected, branch, { existing: true });
    else if (git.hasRef('refs/remotes/origin/' + branch)) git.addWorktree(expected, branch, { track: 'origin/' + branch });
    else git.addWorktree(expected, branch, { from: main });
    app.serialize(() => app.tasks.recordWorktree(card.id, expected));
    return { key, branch, worktreePath: expected, created: true };
  } finally { app.close(); }
}
