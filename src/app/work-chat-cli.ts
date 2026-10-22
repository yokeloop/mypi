import { spawn } from 'node:child_process';
import type { WorkChatCli } from './startup-registration.js';

const OUTPUT_LIMIT = 1024 * 1024;

/** Linux-only slash CLI, not a general executor or a native Pi launcher.
 * A new session/group keeps this observer out of Pi's terminal foreground set.
 * Only the group created by this spawn is signalled; escaped descendants are not tracked.
 */
export const workChatCli: WorkChatCli = async (cli, args, { cwd, timeout, signal }) => {
  if (process.platform !== 'linux') throw new Error('work-chat slash execution requires Linux');
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 30000) throw new Error('work-chat CLI requires a timeout of 1..30000 ms');
  if (signal?.aborted) return { code: 1, killed: true, stdout: '', stderr: 'work-chat CLI cancelled before dispatch' };
  return new Promise(resolve => {
    // Standalone Pi's process.execPath is Pi, not Node. Keep the existing PATH Node dispatch.
    const child = spawn('node', [cli, ...args], { cwd, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0, failure: string | undefined, killed = false, groupStopped = false;
    const stopGroup = () => {
      if (groupStopped || !child.pid) return;
      groupStopped = true;
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          failure = `work-chat CLI group cleanup failed: ${(error as Error).message}`;
          child.kill('SIGKILL');
        }
      }
    };
    const interrupt = (reason: string) => {
      failure ??= reason;
      killed = true;
      stopGroup();
      // Do not wait forever for pipes inherited by a descendant that escaped the group.
      child.stdout.destroy(); child.stderr.destroy();
    };
    const abort = () => interrupt('work-chat CLI cancelled');
    const timer = setTimeout(() => interrupt('work-chat CLI timed out'), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const capture = (chunks: Buffer[], data: Buffer) => {
      const remaining = OUTPUT_LIMIT - bytes;
      chunks.push(data.subarray(0, remaining));
      bytes += Math.min(data.length, remaining);
      if (data.length > remaining) interrupt('work-chat CLI output limit exceeded');
    };
    child.stdout.on('data', (data: Buffer) => capture(stdout, data));
    child.stderr.on('data', (data: Buffer) => capture(stderr, data));
    child.on('error', error => { failure ??= `work-chat CLI spawn failed: ${error.message}`; });
    // Even successful CLI exit must not leave ordinary descendants holding pipes or running.
    child.on('exit', (_code, exitSignal) => {
      if (exitSignal) failure ??= `work-chat CLI terminated by ${exitSignal}`;
      stopGroup();
    });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ code: failure ? 1 : code ?? 1, killed, stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: (failure ? `${failure}; action may have occurred, inspect before retry.\n` : '') + Buffer.concat(stderr).toString('utf8') });
    });
  });
};
