import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { fileURLToPath } from 'node:url';
import { checkBuildState } from '../../../scripts/build-state-core.mjs';

/** Admission is independent of compiled adapters so an invalid build cannot register old tools. */
export default async function (pi: ExtensionAPI) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  try {
    checkBuildState(root);
  } catch (error) {
    // Pi stays usable; never attempt to import the dist-dependent runtime on failure.
    console.error(error instanceof Error ? error.message : String(error));
    return;
  }
  const entry = fileURLToPath(new URL('../../../dist/src/mcp/main.js', import.meta.url));
  const { registerMypiRuntime } = await import('../runtime.js');
  registerMypiRuntime(pi, root, entry);
}
