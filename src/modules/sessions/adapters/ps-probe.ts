import type { ProcessProbe } from '../ports.js';
const firstLine = (output: string) => output.split('\n')[0]!;
export function psProbe(run: (pid: number) => string | undefined,
  kill: (pid: number, signal: 0) => unknown = (pid, signal) => process.kill(pid, signal)): ProcessProbe {
  return {
    start(pid) {
      try { kill(pid, 0); } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ESRCH') return undefined;
        if (code !== 'EPERM') throw error;
      }
      const output = run(pid);
      if (output === undefined) return undefined;
      const line = firstLine(output);
      return line.length < 24 ? undefined : line.slice(0, 24);
    },
    args(pid) {
      const output = run(pid);
      if (output === undefined) return null;
      return firstLine(output).slice(24).trim().split(/\s+/).filter(Boolean);
    },
  };
}
