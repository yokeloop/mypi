import { execFileSync } from 'node:child_process';
import { InputError } from '../../shared/errors.js';

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
