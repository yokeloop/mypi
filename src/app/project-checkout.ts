import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { throttleProgress } from './clone-progress.js';
import { createApp } from './create-app.js';
import { cloneRepository, initRepository, projectGit } from '../infrastructure/git/project-git.js';
import { checkoutTarget, cloneStaging, planCheckout, stagingPid } from '../modules/projects/public.js';
import type { CheckoutState, Project } from '../modules/projects/public.js';
import { CancelledError, InputError } from '../shared/errors.js';

export type PreparedCheckout = { code: string; checkoutPath: string; action: 'cloned' | 'initialized' | 'adopted' };
export type PrepareOptions = { signal?: AbortSignal; onProgress?: (line: string) => void };

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

function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  return true;
}

function clearStaging(target: string): void {
  const parent = dirname(target);
  for (const name of readdirSync(parent)) {
    const pid = stagingPid(target, name);
    const path = join(parent, name);
    if (pid === null || !lstatSync(path).isDirectory()) continue;
    if (pid !== process.pid && alive(pid)) {
      throw new InputError(path + ' is being prepared by process ' + pid + '; wait for that /open to finish or cancel it, then open again (if no clone is running, remove '
        + path + '); nothing was changed');
    }
    rmSync(path, { recursive: true, force: true });
  }
}

function describe(state: CheckoutState, expected: string | null): string {
  return state.kind === 'repository' ? 'origin ' + (state.origin ?? 'none') + ', expected ' + (expected ?? 'none')
    : state.kind === 'other' ? state.reason : state.kind;
}

export async function prepareCheckout(filename: string, project: Project, projectsRoot: string, options: PrepareOptions = {}): Promise<PreparedCheckout> {
  const identity = project.org + '/' + project.slug;
  if (options.signal?.aborted) throw new CancelledError('open cancelled while preparing ' + identity + '; nothing was registered');
  const target = checkoutTarget(projectsRoot, project);
  const state = inspectCheckout(target);
  const plan = planCheckout(project, target, state);
  const repository = project.repository!;
  if (plan === 'clone') {
    mkdirSync(dirname(target), { recursive: true });
    clearStaging(target);
    const staging = cloneStaging(target, process.pid);
    const { signal, onProgress } = options;
    let report: ((line: string, heartbeat: boolean) => void) | undefined;
    if (onProgress) {
      onProgress('cloning ' + repository + ' into ' + target);
      report = throttleProgress(line => onProgress('cloning ' + repository + ' into ' + target + ': ' + line));
    }
    try { await cloneRepository(repository, staging, { ...(signal ? { signal } : {}), ...(report ? { onLine: report } : {}) }); } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      if (error instanceof CancelledError) {
        throw new CancelledError('open cancelled while cloning ' + repository + ' into ' + target + '; nothing was registered');
      }
      throw new InputError('Cloning ' + repository + ' into ' + target + ' failed: ' + (error as Error).message + '; nothing was registered');
    }
    const cloned = inspectCheckout(staging);
    if (cloned.kind !== 'repository' || cloned.origin !== repository) {
      rmSync(staging, { recursive: true, force: true });
      throw new InputError('The new clone of ' + repository + ' did not verify (' + describe(cloned, repository) + '); it was removed; nothing was registered');
    }
    try { renameSync(staging, target); } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw new InputError('Cannot move the new clone into ' + target + ': ' + (error as Error).message + '; it was removed; nothing was registered');
    }
  } else if (plan === 'init') {
    mkdirSync(dirname(target), { recursive: true });
    try { initRepository(target); } catch (error) {
      const tail = existsSync(join(target, '.git')) ? '; remove ' + join(target, '.git') + ' before retrying' : '';
      throw new InputError('Initializing the local repository ' + target + ' failed: ' + (error as Error).message
        + '; nothing was registered' + tail);
    }
    const after = inspectCheckout(target);
    if (after.kind !== 'repository' || after.origin !== null) {
      throw new InputError('The new clone at ' + target + ' did not verify (' + describe(after, null) + '); nothing was registered; inspect ' + target);
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

export async function prepareCheckouts(filename: string, projects: Project[], projectsRoot: string,
  options: PrepareOptions = {}): Promise<PreparedCheckout[]> {
  const unique = projects.filter((p, i) => projects.findIndex(q => q.id === p.id) === i);
  const done: PreparedCheckout[] = [];
  for (const project of unique) {
    try { done.push(await prepareCheckout(filename, project, projectsRoot, options)); } catch (error) {
      if (done.length === 0) throw error;
      const message = (error as Error).message + '; already prepared and registered: '
        + done.map(d => d.code + ' at ' + d.checkoutPath).join(', ') + '; nothing was opened';
      throw error instanceof CancelledError ? new CancelledError(message) : new InputError(message);
    }
  }
  return done;
}
