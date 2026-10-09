import { spawn } from 'node:child_process';

/** Pi owns terminal rendering and input. No shell, output capture or separate process group. */
export function spawnPi(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{
  code: number | null; signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn('pi', args, { cwd, env, stdio: 'inherit', shell: false });
    const handlers = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(signal => {
      const forward = () => { child.kill(signal); };
      process.on(signal, forward);
      return { signal, forward };
    });
    const cleanup = () => { for (const { signal, forward } of handlers) process.removeListener(signal, forward); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', (code, signal) => { cleanup(); resolve({ code, signal }); });
  });
}
