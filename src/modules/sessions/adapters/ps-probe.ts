import type { ProcessProbe } from '../ports.js';
type Run = (pid: number) => { status: number | null; stdout: string };
const firstLine = (output: string) => output.split('\n')[0]!;
export function psProbe(run: Run,
  kill: (pid: number, signal: 0) => unknown = (pid, signal) => process.kill(pid, signal)): ProcessProbe {
  const alive = (pid: number): boolean => {
    try { kill(pid, 0); return true; } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return false;
      if (code === 'EPERM') return true;
      throw error;
    }
  };
  return {
    start(pid) {
      if (!alive(pid)) return undefined;
      let result;
      try { result = run(pid); } catch (error) {
        throw new Error('Cannot read process ' + pid + ' through ps: ' + (error as Error).message);
      }
      const line = firstLine(result.stdout);
      if (result.status === 0 && line.length >= 24) return line.slice(0, 24);
      if (result.status === 1 && result.stdout.trim() === '' && !alive(pid)) return undefined;
      throw new Error('Cannot read process ' + pid + ' through ps: exit status ' + result.status);
    },
    args(pid) {
      let result;
      try { result = run(pid); } catch { return null; }
      if (result.status !== 0) return null;
      return firstLine(result.stdout).slice(24).trim().split(/\s+/).filter(Boolean);
    },
  };
}
