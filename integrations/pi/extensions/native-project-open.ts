import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { Installation } from '../../../dist/src/app/installation.js';
import { createMypiRegistryCache, mypiActions, mypiCompletions, mypiHelp, parseMypiCommand } from '../../../dist/src/app/native-command-descriptors.js';
import { nativeOpeningNode } from './native-opening-node.js';
import type { OpeningInput } from './native-opening-node.js';

const describe = (value: unknown) => JSON.stringify(value);

export function registerNativeProjectOpen(pi: ExtensionAPI, installation: Installation): void {
  let currentCwd: string | undefined;
  const cache = createMypiRegistryCache(async cwd => {
    const response = await nativeOpeningNode(installation, cwd, { action: 'list' });
    if (!response.ok) throw new Error(response.error.message);
    if (response.value.state !== 'projects') throw new Error('Unexpected registry listing');
    return [...response.value.organizations, ...response.value.projects];
  }, JSON.stringify(installation));
  pi.on('session_start', (_event, ctx) => {
    currentCwd = ctx.cwd;
    void cache.refresh(ctx.cwd).then(() => {
      if (cache.failure(ctx.cwd)) ctx.ui.notify(`mypi registry unavailable: ${cache.failure(ctx.cwd)}. Use /mypi open to retry.`, 'warning');
    });
    // Do not block Pi startup; completion never retries a failed read per keystroke.
  });
  const show = (response: Awaited<ReturnType<typeof nativeOpeningNode>>, ctx: { ui: { notify(text: string, level: 'info' | 'warning' | 'error'): void } }) => {
    if (!response.ok) {
      const error = response.error;
      const target = error.herdrSocketPath ? ` Server: ${error.herdrSocketPath}; stage: ${error.stage ?? 'unknown'}; tab: ${error.tabId ?? 'unknown'}; pane: ${error.paneId ?? 'unknown'}.` : '';
      ctx.ui.notify(error.message + target, 'error'); return;
    }
    const value = response.value;
    if (value.state === 'ready') ctx.ui.notify(`Pi startup observed in tab ${value.receipt.tabId}. Check the target screen for rendered UI.`, 'info');
    else if (value.state === 'failed') ctx.ui.notify(`Pi exited in tab ${value.receipt.tabId} before readiness was reported (${value.receipt.observation ?? 'unknown exit'}${value.receipt.exitCode === undefined ? '' : `, exit ${value.receipt.exitCode}`}). Inspect the retained target for diagnostics.`, 'error');
    else if (value.state === 'submitted') ctx.ui.notify(`Tab ${value.receipt.tabId} submitted; startup not confirmed (${value.receipt.observation ?? 'unknown'}). Inspect the retained target before retrying.`, 'warning');
    else if (value.state === 'choices') ctx.ui.notify(value.message + (value.choices.length ? `\n${value.choices.map(c => `${c.branch}: ${c.worktree}`).join('\n')}` : ''), 'info');
    else if (value.state === 'projects') ctx.ui.notify(value.message + `\nOrganizations: ${value.organizations.join(', ') || '(none)'}\nProjects: ${value.projects.join(', ') || '(none)'}`, 'info');
    else ctx.ui.notify(value.state === 'organization' ? `Registered organization: ${value.organization}` :
      value.state === 'selected' ? `Existing worktree: ${value.choice.worktree}` : 'Opening result received', 'info');
  };
  pi.registerCommand('mypi', {
    description: 'Open an organization/project tab or show mypi help',
    getArgumentCompletions: prefix => {
      if (prefix.startsWith('open ') && currentCwd) cache.warm(currentCwd);
      const items = mypiCompletions(prefix, currentCwd ? cache.targets(currentCwd) : []);
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      try {
        currentCwd = ctx.cwd;
        let command = parseMypiCommand(args);
        if (command.action === 'menu') {
          if (!ctx.hasUI) { ctx.ui.notify(mypiHelp(), 'info'); return; }
          const labels = mypiActions.map(action => `${action.name} — ${action.description}`);
          const selected = await ctx.ui.select('mypi actions', labels);
          if (!selected) return;
          command = parseMypiCommand(mypiActions[labels.indexOf(selected)]?.name ?? 'help');
        }
        if (command.action === 'help') { ctx.ui.notify(mypiHelp(), 'info'); return; }
        // Always refresh before an effect, including explicit targets; a stale/failed completion snapshot is not authority.
        await cache.refresh(ctx.cwd);
        if (cache.failure(ctx.cwd)) { ctx.ui.notify(`Registry unavailable: ${cache.failure(ctx.cwd)}`, 'error'); return; }
        let target = command.target;
        const targets = cache.targets(ctx.cwd);
        if (!target) {
          if (!ctx.hasUI) { ctx.ui.notify(`Registered targets: ${targets.join(', ') || '(none)'}. Use /mypi open org or org/project.`, 'info'); return; }
          if (!targets.length) { ctx.ui.notify('No registered organizations or projects. Register a project first.', 'warning'); return; }
          target = await ctx.ui.select('Open organization or project', [...targets]);
          if (!target) return;
        }
        if (!targets.includes(target)) { ctx.ui.notify(`Unknown registered organization or project: ${target}`, 'error'); return; }
        let worktree = command.worktree;
        if (command.pickWorktree) {
          const listed = await nativeOpeningNode(installation, ctx.cwd, { action: 'list', project: target });
          if (!listed.ok) { ctx.ui.notify(listed.error.message, 'error'); return; }
          if (listed.value.state !== 'choices') { ctx.ui.notify('No worktree choices returned', 'error'); return; }
          if (!listed.value.choices.length) { ctx.ui.notify(listed.value.message, 'warning'); return; }
          if (!ctx.hasUI) { show(listed, ctx); return; }
          const labels = listed.value.choices.map(item => `${item.branch} — ${item.worktree}`);
          const selected = await ctx.ui.select('Existing Git worktree', labels);
          if (!selected) return;
          worktree = listed.value.choices[labels.indexOf(selected)]?.worktree;
          if (!worktree) return;
        }
        const input: OpeningInput = { action: 'open', ...(target.includes('/') ? { project: target } : { organization: target }),
          ...(worktree === undefined ? {} : { worktree }) };
        const opened = await nativeOpeningNode(installation, ctx.cwd, input);
        if (!opened.ok && opened.error.state === 'observed-conflict' && ctx.hasUI) {
          const proceed = await ctx.ui.select(opened.error.message, ['Cancel', 'Open another session explicitly']);
          if (proceed !== 'Open another session explicitly') return;
          show(await nativeOpeningNode(installation, ctx.cwd, { ...input, allowObservedSession: true }), ctx);
        } else show(opened, ctx);
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
    },
  });
  pi.registerTool({
    name: 'mypi_project_open', label: 'Open mypi scope',
    description: 'Read-only list with action:list; explicit action:open opens a registered organization or project base checkout (or a Git-confirmed existing worktree). Legacy omitted action: project alone lists worktrees, project plus worktree opens. Organization alone lists/validates and never opens. Never creates clones/worktrees. Observed duplicate requires prior explicit operator consent.',
    parameters: Type.Object({ action: Type.Optional(Type.Union([Type.Literal('list'), Type.Literal('open')])),
      organization: Type.Optional(Type.String()), project: Type.Optional(Type.String()), worktree: Type.Optional(Type.String()),
      allowObservedSession: Type.Optional(Type.Boolean({ description: 'True only after prior explicit approval despite a known session.' })) }),
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      try {
        if (signal?.aborted) throw new Error('Opening cancelled before effects');
        const response = await nativeOpeningNode(installation, ctx.cwd, params, signal);
        const result = response.ok ? response.value : response.error;
        return { content: [{ type: 'text' as const, text: describe(result) }], details: result,
          ...(response.ok && result.state !== 'failed' ? {} : { isError: true }) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details = { state: error && typeof error === 'object' && 'status' in error ? error.status : 'error', message,
          ...(error && typeof error === 'object' && 'stage' in error ? { stage: error.stage } : {}),
          ...(error && typeof error === 'object' && 'tabId' in error ? { tabId: error.tabId } : {}),
          ...(error && typeof error === 'object' && 'paneId' in error ? { paneId: error.paneId } : {}),
          ...(error && typeof error === 'object' && 'herdrSocketPath' in error ? { herdrSocketPath: error.herdrSocketPath } : {}) };
        return { content: [{ type: 'text' as const, text: describe(details) }], details, isError: true };
      }
    },
  });
}
