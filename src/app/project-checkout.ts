import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createApp } from './create-app.js';
import { cloneRepository, initRepository, projectGit } from '../infrastructure/git/project-git.js';
import { LOCAL_REPOSITORY, checkoutTarget, planCheckout } from '../modules/projects/public.js';
import type { CheckoutState, Project } from '../modules/projects/public.js';
import { InputError } from '../shared/errors.js';

export type PreparedCheckout = { code: string; checkoutPath: string; action: 'cloned' | 'initialized' | 'adopted' };

export function inspectCheckout(target: string): CheckoutState {
  let stat;
  try { stat = lstatSync(target); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }
  if (stat.isSymbolicLink()) return { kind: 'other', reason: 'is a symbolic link' };
  if (!stat.isDirectory()) return { kind: 'other', reason: 'is not a directory' };
  if (readdirSync(target).length === 0) return { kind: 'empty' };
  const git = projectGit(target);
  const top = git.topLevel();
  if (top !== null && realpathSync(top) === realpathSync(target)) return { kind: 'repository', origin: git.originUrl() };
  return { kind: 'other', reason: 'is a non-empty directory that is not the top level of a Git repository' };
}

export function prepareCheckout(filename: string, project: Project, projectsRoot: string): PreparedCheckout {
  const identity = project.org + '/' + project.slug;
  const target = checkoutTarget(projectsRoot, project);
  const state = inspectCheckout(target);
  const plan = planCheckout(project, target, state);
  const repository = project.repository!;
  if (plan === 'clone') {
    mkdirSync(dirname(target), { recursive: true });
    try { cloneRepository(repository, target); } catch (error) {
      const tail = state.kind === 'missing' && existsSync(target)
        ? '; git left ' + target + ' behind, inspect and remove it before retrying' : '';
      throw new InputError('Cloning ' + repository + ' into ' + target + ' failed: ' + (error as Error).message + '; nothing was registered' + tail);
    }
  } else if (plan === 'init') {
    mkdirSync(dirname(target), { recursive: true });
    try { initRepository(target); } catch (error) {
      const tail = existsSync(join(target, '.git')) ? '; remove ' + join(target, '.git') + ' before retrying' : '';
      throw new InputError('Initializing the local repository ' + target + ' failed: ' + (error as Error).message
        + '; nothing was registered' + tail);
    }
  }
  if (plan !== 'adopt') {
    const after = inspectCheckout(target);
    const expected = repository === LOCAL_REPOSITORY ? null : repository;
    if (after.kind !== 'repository' || after.origin !== expected) {
      const detail = after.kind === 'repository' ? 'origin ' + (after.origin ?? 'none') + ', expected ' + (expected ?? 'none')
        : after.kind === 'other' ? after.reason : after.kind;
      throw new InputError('The new clone at ' + target + ' did not verify (' + detail + '); nothing was registered; inspect ' + target);
    }
  }
  const action = plan === 'clone' ? 'cloned' : plan === 'init' ? 'initialized' : 'adopted';
  const app = createApp(filename, false);
  try {
    const registered = (() => {
      try { return app.serialize(() => app.projects.updateCheckout(identity, null, target)); } catch (error) {
        if (!(error instanceof InputError)) throw error;
        throw new InputError(target + ' is ready (' + action + ') but registering it failed: ' + error.message
          + '; the directory was kept; register it with mypi project update ' + identity + ' --expected-unset --path ' + target
          + ' (projects {"action":"update","identity":"' + identity + '","expectedCheckoutPath":null,"checkoutPath":"' + target + '"})');
      }
    })();
    return { code: project.code, checkoutPath: registered.checkoutPath!, action };
  } finally { app.close(); }
}

export function prepareCheckouts(filename: string, projects: Project[], projectsRoot: string): PreparedCheckout[] {
  const unique = projects.filter((p, i) => projects.findIndex(q => q.id === p.id) === i);
  const done: PreparedCheckout[] = [];
  for (const project of unique) {
    try { done.push(prepareCheckout(filename, project, projectsRoot)); } catch (error) {
      if (!(error instanceof InputError) || done.length === 0) throw error;
      throw new InputError(error.message + '; already prepared and registered: '
        + done.map(d => d.code + ' at ' + d.checkoutPath).join(', ') + '; nothing was opened');
    }
  }
  return done;
}
