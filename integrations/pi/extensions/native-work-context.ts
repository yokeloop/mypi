import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { existsSync } from 'node:fs';
import { registerNativePathGuard } from './native-path-guard.js';
import {
  MYPI_PI_CONTEXT, PI_CONTEXT_ENTRY, decodePiContext, selectPiContext,
} from '../../../dist/src/app/pi-context.js';
import type { PiContextSelection } from '../../../dist/src/app/pi-context.js';
import { nativeCallerEnvironment, sameNativeCaller } from '../../../dist/src/app/pi-message-caller.js';

/** Native branch entries own context; the launch envelope is only a fresh-session handoff. */
export function registerNativeWorkContext(pi: ExtensionAPI, root: string, entry: string) {
  registerNativePathGuard(pi);
  let requested: ReturnType<typeof nativeCallerEnvironment> | undefined;
  let registrationError = false;
  let launchProblem: string | undefined;

  function refresh(ctx: ExtensionContext): PiContextSelection {
    const selection = selectPiContext(ctx.sessionManager.getBranch(), ctx.cwd);
    const env = nativeCallerEnvironment(selection, ctx.sessionManager.getSessionId());
    if (!sameNativeCaller(requested, env)) {
      try {
        // Explicit clear prevents inherited process env from reviving an old MCP selection.
        pi.registerMcpServer('mypi', {
          command: 'node', args: [entry], cwd: root, env,
          description: 'Local mypi tools for memory, projects, requests and history. No automatic initialization or writes.',
          exposure: 'codemode', toolExposure: { project_resolve: 'direct', warmup: 'direct' },
        });
        registrationError = false;
      } catch {
        registrationError = true;
        ctx.ui.notify('mypi MCP registration failed. Inspect /mcp; server context is not confirmed.', 'error');
      }
      requested = env;
    }
    const scope = selection.state === 'selected' ? selection.data.context.scope : undefined;
    const label = scope?.kind === 'project' ? scope.project
      : scope?.kind === 'organization' ? `${scope.organization} (organization)`
      : scope?.kind === 'unrestricted' ? 'unrestricted' : `context not selected (${launchProblem ?? selection.state})`;
    ctx.ui.setStatus('mypi-context', `mypi: ${label} | MCP ${registrationError ? 'registration error' : 'requested/unconfirmed'}`);
    return selection;
  }

  pi.on('session_start', (event, ctx) => {
    launchProblem = undefined;
    const manager = ctx.sessionManager;
    const file = manager.getSessionFile();
    // "startup" also covers --session/--continue. Never infer freshness from the event alone.
    const fresh = event.reason === 'startup' && (!file || !existsSync(file)) && !manager.getHeader()?.parentSession
      && manager.getEntries().every(item => item.type === 'model_change' || item.type === 'thinking_level_change');
    const handoff = process.env[MYPI_PI_CONTEXT];
    if (fresh && handoff !== undefined) {
      try {
        const data = decodePiContext(handoff);
        if (data.cwd === ctx.cwd) pi.appendEntry(PI_CONTEXT_ENTRY, data);
        else launchProblem = 'launch cwd mismatch';
      } catch { launchProblem = 'invalid launch context'; }
    } else if (event.reason === 'startup' && handoff !== undefined && selectPiContext(manager.getBranch(), ctx.cwd).state === 'absent') {
      launchProblem = 'existing or ambiguous session; launch context ignored';
    }
    const selection = refresh(ctx);
    if (selection.state !== 'selected') {
      ctx.ui.notify(`mypi context not selected: ${launchProblem ?? selection.state}. Start a new Pi process with an explicit working selection; no previous project was restored.`, 'warning');
    }
  });
  pi.on('session_tree', (_event, ctx) => {
    launchProblem = undefined;
    const selection = refresh(ctx);
    if (selection.state !== 'selected') ctx.ui.notify(`mypi context not selected on this branch (${selection.state}).`, 'warning');
  });
  pi.on('before_agent_start', (event, ctx) => {
    const selection = refresh(ctx);
    const context = selection.state === 'selected' ? JSON.stringify(selection.data.context) : 'not selected';
    event.systemPromptOptions.sections.mypi_work_context = [
      `mypi working context: ${context}. Current cwd: ${JSON.stringify(ctx.cwd)}.`,
      'Use the ordinary Pi tools and existing mypi tools only as requested. Do not automatically initialize storage, warm up memory, register requests or create tabs/worktrees.',
      'For organization context, select a concrete project/worktree before changes. Base checkouts are available for study; this context is not write permission or enforced isolation.',
      'Changing working directory requires a new Pi process. MCP context registration is requested/unconfirmed; user overrides take precedence. Inspect /mcp for connection details.',
    ].join('\n');
  });
}
