import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerNativeWorkContext } from './extensions/native-work-context.js';
import { registerNativeSessionCards } from './extensions/native-session-cards.js';
import { registerNativeMailbox } from './extensions/native-mailbox.js';
import { registerNativeProjectOpen } from './extensions/native-project-open.js';
import { resolveInstallation } from '../../dist/src/app/installation.js';

/** Register adapters only after the entry has admitted this checkout's compiled build. */
export function registerMypiRuntime(pi: ExtensionAPI, engineRoot: string, mcpEntry: string): void {
  let installation;
  try { installation = resolveInstallation(engineRoot, process.env); }
  catch (error) {
    console.error(`mypi setup required: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const env = { MYPI_INSTALLATION_FILE: installation.configPath,
    MYPI_SESSION_DIR: installation.sessionDirectory, MYPI_MAILBOX_DIR: installation.mailboxDirectory };
  registerNativeWorkContext(pi, engineRoot, mcpEntry, env);
  registerNativeSessionCards(pi, { ...process.env, ...env }, installation.homeRoot);
  registerNativeMailbox(pi, { ...process.env, ...env }, installation.homeRoot);
  registerNativeProjectOpen(pi, installation);
}
