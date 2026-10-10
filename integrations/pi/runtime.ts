import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerNativeWorkContext } from './extensions/native-work-context.js';
import { registerNativeSessionCards } from './extensions/native-session-cards.js';
import { registerNativeMailbox } from './extensions/native-mailbox.js';

/** Register adapters only after the entry has admitted this checkout's compiled build. */
export function registerMypiRuntime(pi: ExtensionAPI, engineRoot: string, mcpEntry: string): void {
  registerNativeWorkContext(pi, engineRoot, mcpEntry);
  registerNativeSessionCards(pi);
  registerNativeMailbox(pi);
}
