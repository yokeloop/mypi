import { execFileSync } from 'node:child_process';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { InputError } from '../../shared/errors.js';

/** Resolve before creation, not through an unrelated server shell's PATH. */
export function resolvePiExecutable(env: NodeJS.ProcessEnv, cwd: string): string {
  for (const directory of (env['PATH'] ?? '').split(delimiter)) {
    const filename = resolve(cwd, directory, 'pi');
    try {
      accessSync(filename, constants.X_OK);
      if (statSync(filename).isFile()) return realpathSync(filename);
    } catch { /* Continue caller PATH lookup. */ }
  }
  throw new InputError('Pi executable unavailable on caller PATH; no Herdr tab was created');
}
export function herdrRunner(env: NodeJS.ProcessEnv) {
  // Snapshot the explicit caller socket/context for every invocation.
  const environment = { ...env };
  return (args: readonly string[]): { code: 0; stdout: string } => {
    try {
      const output = execFileSync('herdr', [...args], { env: environment, encoding: 'utf8',
        timeout: 5000, maxBuffer: 256 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: 0, stdout: output };
    } catch {
      // Child errors contain argv/environment/terminal output. Never expose those here.
      throw new InputError('Herdr unavailable or acknowledgement invalid; inspect the explicit server before retrying');
    }
  };
}
