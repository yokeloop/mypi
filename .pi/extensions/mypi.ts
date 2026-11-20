import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { install } from './mypi-lib/install.js';
import type { ExtensionAPI } from './mypi-lib/install.js';
import { serveEvents } from './mypi-lib/event-socket.js';
import { spawnCli } from './mypi-lib/cli-runner.js';
import { runtimeDir } from './mypi-lib/runtime-dir.js';

export default function mypi(pi: ExtensionAPI): void {
  install(pi, realpathSync(fileURLToPath(new URL('../../', import.meta.url))), serveEvents, runtimeDir(process.env), process.pid, spawnCli);
}
