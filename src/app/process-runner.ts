import { spawnSync } from 'node:child_process';

export function runPs(pid: number): string | undefined {
  const result = spawnSync('/bin/ps', ['-ww', '-o', 'lstart=,args=', '-p', String(pid)],
    { env: { LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8', timeout: 1000 });
  if (result.status !== 0 || result.error || result.stdout.trim() === '') return undefined;
  return result.stdout;
}
