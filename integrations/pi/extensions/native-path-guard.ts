import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { homedir } from 'node:os';
import { loadSelectedGuardPolicy } from '../../../dist/src/app/guard-policy-config.js';
import { guardNativeWrite } from '../../../dist/src/app/native-write-guard.js';
import type { NativeGuardPolicy } from '../../../dist/src/app/native-write-guard.js';
import { selectPiContext } from '../../../dist/src/app/pi-context.js';
import { observeWriteWorkspace } from '../../../dist/src/app/write-workspace-observation.js';

export function registerNativePathGuard(pi: ExtensionAPI): void {
  let configuration: NativeGuardPolicy;
  try { configuration = { policy: loadSelectedGuardPolicy(process.env) }; }
  catch (error) {
    configuration = { error: `mypi guard policy unavailable: ${error instanceof Error ? error.message : 'invalid configuration'}. Fix MYPI_GUARD_POLICY and reload; write/edit are blocked.` };
  }
  pi.on('session_start', (_event, ctx) => {
    if ('error' in configuration) ctx.ui.notify(configuration.error, 'error');
  });
  pi.on('tool_call', (event, ctx) => guardNativeWrite({
    toolName: event.toolName, path: event.input.path, cwd: ctx.cwd, home: homedir(),
    selection: selectPiContext(ctx.sessionManager.getBranch(), ctx.cwd), configuration,
    observe: observeWriteWorkspace, warn: message => ctx.ui.notify(message, 'warning'),
  }));
}
