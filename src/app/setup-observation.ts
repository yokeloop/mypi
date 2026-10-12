import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { contextGit } from '../infrastructure/git/context-git.js';
import { join, resolve } from 'node:path';
import { browseDirectory } from '../infrastructure/filesystem/setup-browse.js';
import type { BrowseResult } from '../infrastructure/filesystem/setup-browse.js';
import { validateInstallation, composeInstallation, validateInstallationStateLayout } from './installation.js';
import { canonicalFuturePath } from '../infrastructure/filesystem/paths.js';
import type { InstallationBinding } from './installation.js';
import { planInstallation, planHomeClone, validateSetupLocation } from './setup-installation.js';
import type { SetupChoices } from './setup-installation.js';
import { SetupError, setupProblem } from './setup-problem.js';
import type { SetupProblem } from './setup-problem.js';

export { setupProblem };
export type { SetupProblem, BrowseResult };
export function browseSetupDirectory(path: string, query = '', offset = 0, limit = 80): BrowseResult {
  return browseDirectory(path, query, offset, limit);
}
export interface HomeCandidate { path: string; source: 'binding' | 'legacy' | 'checkout'; kind: 'eligible' | 'absent' | 'occupied' | 'invalid' }
export interface SetupObservation {
  engineRoot: string;
  status: 'configured' | 'unconfigured' | 'invalid' | 'conflict';
  binding?: InstallationBinding;
  problem?: SetupProblem;
  homeCandidates: HomeCandidate[];
}
function kindFile(path: string): 'file' | 'other' | 'missing' | 'invalid' {
  try { return lstatSync(path).isFile() ? 'file' : 'other'; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid'; }
}
function kind(path: string): HomeCandidate['kind'] {
  let entry: ReturnType<typeof lstatSync>;
  try { entry = lstatSync(path); }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'invalid'; }
  if (entry.isSymbolicLink()) return 'invalid';
  if (!entry.isDirectory()) return 'occupied';
  try { contextGit(path).inspectRepository(); return 'eligible'; }
  catch { return 'occupied'; }
}
/** Observes only the current checkout and directly named candidate homes; no setup writes or disk scan. */
export function observeSetup(engineRoot: string): SetupObservation {
  const engine = realpathSync(engineRoot);
  const bindingPath = join(engine, '.mypi-local.json');
  const candidates: HomeCandidate[] = [];
  let binding: InstallationBinding | undefined;
  let problem: SetupProblem | undefined;
  let status: SetupObservation['status'] = 'unconfigured';
  let bindingPresent = false;
  try { lstatSync(bindingPath); bindingPresent = true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      status = 'invalid'; problem = setupProblem(new SetupError('binding-invalid', 'Cannot inspect installation binding at ' + bindingPath, 'binding', ['reconcile']));
    }
  }
  if (bindingPresent) {
    try {
      const input: unknown = JSON.parse(readFileSync(bindingPath, 'utf8')) as unknown;
      binding = validateInstallation(input);
      composeInstallation(binding, engine, bindingPath);
      if (kind(binding.homeRoot) !== 'eligible' || kindFile(binding.database) !== 'file') throw new Error('Bound home repository or database is unavailable');
      status = 'configured';
      candidates.push({ path: binding.homeRoot, source: 'binding', kind: 'eligible' });
    } catch {
      binding = undefined;
      status = 'invalid'; problem = setupProblem(new SetupError('binding-invalid', 'Invalid or unreadable installation binding at ' + bindingPath, 'binding', ['reconcile']));
    }
  }
  const pi = join(engine, '.pi');
  try {
    if (lstatSync(pi).isSymbolicLink()) {
      const target = resolve(engine, readlinkSync(pi));
      if (target.endsWith('/pi')) candidates.push({ path: resolve(target, '..'), source: 'legacy', kind: kind(resolve(target, '..')) });
      else { status = 'conflict'; problem = setupProblem(new SetupError('local-conflict', 'Existing .pi link requires reconciliation: ' + pi, 'homeRoot', ['reconcile'])); }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { status = 'conflict'; problem = setupProblem(error); } }
  const checkoutHome = join(engine, 'home');
  if (!candidates.some(candidate => candidate.path === checkoutHome)) candidates.push({ path: checkoutHome, source: 'checkout', kind: kind(checkoutHome) });
  return { engineRoot: engine, status, ...(binding ? { binding } : {}), ...(problem ? { problem } : {}), homeCandidates: candidates };
}
/** Early partial checks; completed choices still go through the authoritative installation planner. */
export function validateSetupChoice(engineRoot: string, choices: Partial<SetupChoices>): SetupProblem | undefined {
  try {
    if (choices.homeMode && choices.homeMode !== 'clone' && choices.homeRoot && choices.databaseMode && choices.database && choices.stateRoot) {
      planInstallation(engineRoot, choices as SetupChoices);
      return undefined;
    }
    if (choices.homeRoot && choices.homeMode) {
      if (choices.homeMode === 'clone') {
        if (choices.remote) planHomeClone(engineRoot, choices.homeRoot, choices.remote);
        else validateSetupLocation(engineRoot, 'new', choices.homeRoot, 'homeRoot');
      } else validateSetupLocation(engineRoot, choices.homeMode, choices.homeRoot, 'homeRoot');
    }
    if (choices.database && choices.databaseMode) validateSetupLocation(engineRoot, choices.databaseMode, choices.database, 'database', choices.homeRoot);
    if (choices.stateRoot) validateSetupLocation(engineRoot, 'existing', choices.stateRoot, 'stateRoot', choices.homeRoot);
    if (choices.database && choices.stateRoot) {
      try { validateInstallationStateLayout(canonicalFuturePath(choices.database), canonicalFuturePath(choices.stateRoot)); }
      catch { throw new SetupError('invalid-path', 'Database file cannot equal or contain a runtime state or cache directory; choose separate paths', 'database', ['change']); }
    }
  } catch (error) { return setupProblem(error); }
}
