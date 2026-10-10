import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { canonicalDirectory, canonicalFuturePath, externalStatePath } from '../infrastructure/filesystem/paths.js';
import { InputError } from '../shared/errors.js';

export const MYPI_INSTALLATION_FILE = 'MYPI_INSTALLATION_FILE';
export interface InstallationBinding {
  version: 1;
  engineRoot: string;
  homeRoot: string;
  database: string;
  stateRoot: string;
}
export interface Installation extends InstallationBinding {
  configPath: string;
  sessionDirectory: string;
  mailboxDirectory: string;
}
function record(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === 'object' && !Array.isArray(input);
}
/** Non-effectful format check; filesystem aliases are checked separately. */
export function validateInstallation(input: unknown): InstallationBinding {
  if (!record(input) || Object.keys(input).sort().join(',') !== 'database,engineRoot,homeRoot,stateRoot,version'
    || input['version'] !== 1 || ['engineRoot', 'homeRoot', 'database', 'stateRoot'].some(key =>
      typeof input[key] !== 'string' || !isAbsolute(input[key]) || (input[key] as string).includes('\0'))) {
    throw new InputError('Invalid .mypi-local.json version 1 binding; run pnpm bootstrap to select this installation');
  }
  return input as unknown as InstallationBinding;
}
function contains(parent: string, child: string): boolean {
  const within = relative(parent, child);
  return within === '' || (!isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep));
}
/** Does not open the database or create any paths. */
export function composeInstallation(binding: InstallationBinding, engineRoot: string, configPath: string,
  env: Readonly<Record<string, string | undefined>> = {}): Installation {
  const engine = canonicalDirectory(engineRoot), home = canonicalFuturePath(binding.homeRoot);
  if (canonicalDirectory(binding.engineRoot) !== engine) throw new InputError('Installation belongs to a different engine: ' + configPath);
  if (contains(home, engine) || (contains(engine, home) && home !== join(engine, 'home'))) throw new InputError('Home repository must be separate from engine repository or the ignored engine/home');
  const database = externalStatePath(externalStatePath(binding.database, engine, 'Database'), home, 'Database');
  const stateRoot = externalStatePath(externalStatePath(binding.stateRoot, engine, 'Runtime state'), home, 'Runtime state');
  const sessionDirectory = externalStatePath(externalStatePath(join(stateRoot, 'sessions'), engine, 'Session cache'), home, 'Session cache');
  const mailboxDirectory = externalStatePath(externalStatePath(join(stateRoot, 'mailbox'), engine, 'Mailbox'), home, 'Mailbox');
  for (const [key, expected] of [['MYPI_SESSION_DIR', sessionDirectory], ['MYPI_MAILBOX_DIR', mailboxDirectory]] as const) {
    if (env[key] !== undefined && externalStatePath(env[key], engine, key) !== expected) {
      throw new InputError(`${key} conflicts with selected installation; unset it or select matching stateRoot`);
    }
  }
  return { version: 1, engineRoot: engine, homeRoot: home, database, stateRoot, configPath, sessionDirectory, mailboxDirectory };
}
export function resolveInstallation(engineRoot: string, env: Readonly<Record<string, string | undefined>>): Installation {
  const root = canonicalDirectory(engineRoot), selector = env[MYPI_INSTALLATION_FILE];
  if (selector !== undefined && (!isAbsolute(selector) || selector.includes('\0'))) throw new InputError('MYPI_INSTALLATION_FILE must be an absolute binding path');
  const configPath = selector ?? join(root, '.mypi-local.json');
  let binding: unknown;
  try { binding = JSON.parse(readFileSync(configPath, 'utf8')) as unknown; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new InputError(`Installation not configured at ${configPath}; run pnpm bootstrap to select home, database and runtime state`);
    throw new InputError(`Invalid or unreadable installation binding at ${configPath}; review it or rerun pnpm bootstrap`);
  }
  return composeInstallation(validateInstallation(binding), root, configPath, env);
}
export function installationEnvironment(installation: Installation, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, [MYPI_INSTALLATION_FILE]: installation.configPath,
    MYPI_SESSION_DIR: installation.sessionDirectory, MYPI_MAILBOX_DIR: installation.mailboxDirectory };
}
