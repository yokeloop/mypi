import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerNativeWorkContext } from './native-work-context.js';

/** Context follows Pi's native branch; connection and shutdown remain Pi-owned. */
export default function (pi: ExtensionAPI) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const entry = fileURLToPath(new URL('../../../dist/src/mcp/main.js', import.meta.url));
  if (!existsSync(entry)) throw new Error('mypi is not built. Run mise exec -- pnpm build in the engine checkout.');
  // Pi may be a standalone Bun executable: process.execPath is not necessarily Node.
  // Starting Pi via mise exec supplies the checkout's pinned Node 24 on PATH.
  registerNativeWorkContext(pi, root, entry);
}
