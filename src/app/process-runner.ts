import { spawnSync } from 'node:child_process';

export function runPs(pid: number): { status: number | null; stdout: string } {
  const result = spawnSync('/bin/ps', ['-ww', '-o', 'lstart=,args=', '-p', String(pid)],
    { env: { LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8', timeout: 1000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout };
}
