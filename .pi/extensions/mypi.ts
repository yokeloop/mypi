import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { install } from './mypi-lib/install.js';
import type { ExtensionAPI } from './mypi-lib/install.js';
import { serveEvents } from './mypi-lib/event-socket.js';
import { spawnCli } from './mypi-lib/cli-runner.js';

export default function mypi(pi: ExtensionAPI): void {
  install(pi, realpathSync(fileURLToPath(new URL('../../', import.meta.url))), serveEvents, process.env['XDG_RUNTIME_DIR'], process.pid, spawnCli);
}
