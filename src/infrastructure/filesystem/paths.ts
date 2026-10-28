import { existsSync, realpathSync, statSync, lstatSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { InputError } from '../../shared/errors.js';

export function canonicalDirectory(input: string): string {
  if (!input || input.includes('\0')) throw new InputError('Checkout path must be a directory');
  const path = realpathSync(input);
  if (!statSync(path).isDirectory()) throw new InputError('Checkout path must be a directory');
  return path;
}

export function canonicalAbsoluteDirectory(input: string): string {
  if (!isAbsolute(input)) throw new InputError('Checkout path must be absolute');
  return canonicalDirectory(input);
}

// Resolve the existing ancestor too: lexical containment misses symlinked state roots.
function canonicalFuturePath(input: string): string {
  const suffix: string[] = [];
  let path = resolve(input);
  while (!existsSync(path)) {
    try {
      if (lstatSync(path).isSymbolicLink()) throw new InputError('Dangling symlink in state path');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = dirname(path);
    if (parent === path) throw new InputError('Cannot resolve state path');
    suffix.unshift(basename(path));
    path = parent;
  }
  return join(realpathSync(path), ...suffix);
}

export function databasePath(
  env: Readonly<Record<string, string | undefined>>,
  userHome: string,
  engineRoot: string,
): string {
  const stateRoot = env['XDG_STATE_HOME'] || join(userHome, '.local', 'state');
  if (!isAbsolute(stateRoot)) throw new InputError('XDG_STATE_HOME must be absolute');
  return externalDatabasePath(join(stateRoot, 'mypi', 'state.sqlite3'), engineRoot);
}

export function externalDatabasePath(input: string, engineRoot: string): string {
  if (!isAbsolute(input) || input.includes('\0')) throw new InputError('Database path must be absolute without NUL');
  const filename = canonicalFuturePath(input);
  const root = canonicalFuturePath(engineRoot);
  const inside = relative(root, filename);
  if (inside === '' || (!isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep))) {
    throw new InputError('Database must be outside the engine/context repository');
  }
  return filename;
}

export function sessionRegistryDir(runtime: string | undefined): string {
  if (!runtime || !isAbsolute(runtime) || runtime.includes('\0')) throw new InputError('XDG_RUNTIME_DIR must be an absolute path; the live session registry is kept there');
  return join(runtime, 'mypi', 'sessions');
}
