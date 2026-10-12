import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

/** Only after an explicit reviewed destination/remote and an absent-target recheck. */
export function homeOrigin(home: string): string | undefined {
  const result = spawnSync('git', ['-C', home, 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 3000 });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

export class CloneStartError extends Error {}

function livingGroupMembers(group: number): boolean {
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    let record: string;
    try { record = readFileSync(`/proc/${name}/stat`, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const fields = record.slice(record.lastIndexOf(')') + 2).split(' ');
    if (Number(fields[2]) === group && fields[0] !== 'Z' && fields[0] !== 'X') return true;
  }
  return false;
}

/** Git and its remote helpers share an owned process group; cancellation waits for group teardown. */
export function cloneHome(remote: string, destination: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new CloneStartError('Clone cancelled before start'));
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', '--', remote, destination], { stdio: ['ignore', 'ignore', 'ignore'], shell: false, detached: true });
    let stopped: 'cancelled' | 'timed out' | undefined;
    let escalation: NodeJS.Timeout | undefined;
    // The child is the process-group leader. A negative pid targets its descendants too.
    let teardownFailure = false;
    const killGroup = (signalName: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signalName); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') teardownFailure = true; }
    };
    const stop = (reason: 'cancelled' | 'timed out') => {
      if (stopped) return;
      stopped = reason;
      killGroup('SIGTERM');
      escalation = setTimeout(() => killGroup('SIGKILL'), 1000);
    };
    const cancel = () => stop('cancelled');
    signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(() => stop('timed out'), 30000);
    let failure: Error | undefined;
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      if (escalation) clearTimeout(escalation);
      // A leader can exit while Git helpers still run. Kill and observe the owned group,
      // allowing only bounded time for the kernel to deliver termination signals.
      killGroup('SIGKILL');
      const deadline = Date.now() + 1500;
      const settle = () => {
        let alive = false;
        try { alive = child.pid !== undefined && livingGroupMembers(child.pid); }
        catch { teardownFailure = true; }
        if (alive && !teardownFailure && Date.now() < deadline) { killGroup('SIGKILL'); setTimeout(settle, 10); return; }
        if (alive) teardownFailure = true;
        if (stopped || failure || teardownFailure || code !== 0) reject(failure && !child.pid
          ? new CloneStartError('Git clone could not start')
          : new Error(`Git clone ${stopped ?? 'failed'} at ${destination} (exit ${code ?? 'unknown'}); inspect destination before retrying`));
        else resolve();
      };
      settle();
    });
  });
}
