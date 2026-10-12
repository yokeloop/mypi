import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InputError } from '../../shared/errors.js';

/** Pi 1.0.4 write/edit resolveToCwd spelling on this Linux engine; no read-only filename variants. */
export function resolveNativeToolPath(input: string, cwd: string, home: string): string {
  let path = input.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
  if (path.startsWith('@')) path = path.slice(1);
  if (path === '~') path = home;
  else if (path.startsWith('~/')) path = join(home, path.slice(2));
  else if (/^file:\/\//.test(path)) path = fileURLToPath(path);
  if (path.includes('\0')) throw new InputError('Invalid native tool path');
  return resolve(cwd, path);
}

/** Follow ordinary symlinks; new paths use their nearest existing ancestor. No race containment. */
export function canonicalNativeToolPath(path: string): string {
  const suffix: string[] = [];
  let current = path;
  for (;;) {
    try {
      lstatSync(current); // A dangling link is existing: realpath must fail, not silently climb past it.
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw new InputError('Native tool path unavailable');
      suffix.unshift(basename(current));
      current = parent;
    }
  }
  return join(realpathSync(current), ...suffix);
}
