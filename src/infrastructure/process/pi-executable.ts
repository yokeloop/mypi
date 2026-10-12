import { accessSync, constants, openSync, readSync, closeSync, realpathSync, statSync } from 'node:fs';
import { basename, delimiter, isAbsolute, resolve } from 'node:path';
import { InputError } from '../../shared/errors.js';

/** No PATH fallback after the first candidate: it may select a different installation. */
export function resolvePiExecutable(env: NodeJS.ProcessEnv, cwd: string, nativeExecutable?: string): string {
  const explicit = env['MYPI_PI_EXECUTABLE'];
  const candidate = explicit ?? nativeExecutable ?? (env['PATH'] ?? '').split(delimiter).map(directory => resolve(cwd, directory, 'pi'))
    .find(path => { try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; } });
  if (!candidate || !isAbsolute(candidate)) throw new InputError('Installed Pi unavailable; select MYPI_PI_EXECUTABLE as an absolute installed Pi path before opening');
  try {
    accessSync(candidate, constants.X_OK);
    const path = realpathSync(candidate);
    if (!statSync(path).isFile()) throw new Error();
    // Executable bytes are distribution evidence, not proof that arbitrary code is safe.
    // A PATH script needs explicit selection; do not execute it to discover its behavior.
    if (!explicit && basename(path) !== 'pi') throw new Error();
    const fd = openSync(path, 'r');
    try {
      const header = Buffer.alloc(4);
      if (readSync(fd, header, 0, 4, 0) !== 4 || (!explicit && nativeExecutable === undefined
        && (header[0] !== 0x7f || header.toString('ascii', 1) !== 'ELF'))) throw new Error();
    } finally { closeSync(fd); }
    return path;
  } catch { throw new InputError('Pi executable not confirmed; select an already installed Pi with MYPI_PI_EXECUTABLE (absolute path); no tab was created'); }
}
