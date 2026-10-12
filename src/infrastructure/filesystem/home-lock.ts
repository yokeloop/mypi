import { spawnSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { HomeLock } from '../../shared/home-lock.js';
import { InputError } from '../../shared/errors.js';

/** Linux flock shares this open file description with the caller and its Git children. */
export function acquireHomeLock(root: string): HomeLock {
  const home = realpathSync(root), metadata = join(home, '.git');
  const stat = lstatSync(metadata);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new InputError('Home requires private Git metadata');
  const descriptor = openSync(join(metadata, 'mypi-home.lock'), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const file = fstatSync(descriptor);
    if (!file.isFile() || file.nlink !== 1) throw new InputError('Home lock must be a private regular file');
    const result = spawnSync('/usr/bin/flock', ['--exclusive', '--timeout', '1', '--conflict-exit-code', '75', '3'], {
      stdio: ['ignore', 'pipe', 'pipe', descriptor], timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 4096,
    });
    if (!result.error && result.status === 75) throw new InputError('Home writer is busy; bounded lock wait expired');
    if (result.error || result.status !== 0) throw new InputError('Home advisory lock unavailable');
  } catch (error) { closeSync(descriptor); throw error; }
  let closed = false;
  return { descriptor, close() {
    if (closed) return;
    closed = true;
    // Do not unlock or unlink: a surviving Git child must retain the same lock.
    closeSync(descriptor);
  } };
}
