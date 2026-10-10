import { spawnSync } from 'node:child_process';
import { InputError } from '../../shared/errors.js';

/** Only after an explicit reviewed destination/remote and an absent-target recheck. */
export function homeOrigin(home: string): string | undefined {
  const result = spawnSync('git', ['-C', home, 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 3000 });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

export function cloneHome(remote: string, destination: string): void {
  const result = spawnSync('git', ['clone', '--', remote, destination], { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new InputError(`Git clone failed; inspect ${destination} before retrying (exit ${result.status ?? 'unknown'})`);
}
