import registerStartupExtension, { type ExtensionAPI } from './startup-registration.js';

export default function install(pi: ExtensionAPI): void {
  registerStartupExtension(pi);
}
