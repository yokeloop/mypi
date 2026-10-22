import registerStartupExtension, { type ExtensionAPI } from './startup-registration.js';
import { workChatCli } from './work-chat-cli.js';

/** Keep slash observation out of Pi's foreground process group; warmup/MCP are unchanged. */
export default function install(pi: ExtensionAPI): void {
  registerStartupExtension(pi, workChatCli);
}
