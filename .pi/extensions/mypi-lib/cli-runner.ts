import { spawn } from 'node:child_process';
import type { RunCli } from './install.js';

export const spawnCli: RunCli = (args, { cwd, signal, onLine }) => new Promise(resolve => {
  const child = spawn('node', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', pending = '';
  const onAbort = () => { child.kill('SIGTERM'); };
  signal.addEventListener('abort', onAbort, { once: true });
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
    const lines = (pending + chunk).split('\n');
    pending = lines.pop()!;
    lines.forEach(onLine);
  });
  child.on('error', error => {
    signal.removeEventListener('abort', onAbort);
    resolve({ code: null, signal: null, stdout: '', stderr: error.message });
  });
  child.on('close', (code, sig) => {
    signal.removeEventListener('abort', onAbort);
    if (pending !== '') onLine(pending);
    resolve({ code, signal: sig, stdout, stderr });
  });
});
