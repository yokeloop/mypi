import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { checkBuildState } from './build-state-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  checkBuildState(root);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  // No old compiled entry is started on a failed admission.
}

if (process.exitCode !== 1) {
  const child = spawn(process.execPath, [join(root, 'dist/src/cli/main.js'), ...process.argv.slice(2)], {
    cwd: process.cwd(), stdio: 'inherit', env: process.env,
  });
  const relays = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => {
    const relay = () => child.kill(signal);
    process.on(signal, relay);
    return { signal, relay };
  });
  let spawnFailed = false;
  child.on('error', error => { console.error(error.message); spawnFailed = true; });
  child.on('close', (code, signal) => {
    for (const relay of relays) process.off(relay.signal, relay.relay);
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = spawnFailed ? 1 : code ?? 1;
  });
}
