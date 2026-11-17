import { lstatSync, readFileSync } from 'node:fs';
import { InputError } from '../../shared/errors.js';

export function readPrivateFile(file: string, label: string): string | undefined {
  let stat;
  try { stat = lstatSync(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new InputError(label + ' must be a private regular file (0600): ' + file);
  return readFileSync(file, 'utf8');
}
