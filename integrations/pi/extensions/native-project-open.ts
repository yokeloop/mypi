import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { Installation } from '../../../dist/src/app/installation.js';
import { nativeOpeningNode } from './native-opening-node.js';
const describe = (value: unknown) => JSON.stringify(value);

export function registerNativeProjectOpen(pi: ExtensionAPI, installation: Installation): void {
  pi.registerCommand('mypi', {
    description: 'mypi open: select a registered project and existing Git worktree in a new Herdr tab',
    handler: async (args, ctx) => {
      if (!args.trim().startsWith('open') || (args.trim() !== 'open' && !args.trim().startsWith('open '))) {
        ctx.ui.notify('Usage: /mypi open [org/project]', 'warning'); return;
      }
      const project = args.trim().slice(4).trim() || undefined;
      if (project?.includes(' ')) { ctx.ui.notify('Usage: /mypi open [org/project]', 'warning'); return; }
      try {
        const firstResponse = await nativeOpeningNode(installation, ctx.cwd, { project });
        const first = firstResponse.ok ? firstResponse.value : firstResponse.error;
        if (firstResponse.ok === false) { ctx.ui.notify(describe(firstResponse.error), 'error'); return; }
        if (!ctx.hasUI) { ctx.ui.notify(describe(first), 'warning'); return; }
        const selectedProject = project ?? (first.state === 'projects'
          ? await ctx.ui.select('Registered project', first.projects) : undefined);
        if (!selectedProject) { if (project) ctx.ui.notify(describe(first), 'warning'); return; }
        const selectedResponse = project ? firstResponse : await nativeOpeningNode(installation, ctx.cwd, { project: selectedProject });
        const selected = selectedResponse.ok ? selectedResponse.value : selectedResponse.error;
        if (selected.state !== 'choices' || !selected.choices.length) {
          ctx.ui.notify(selected.state === 'choices' ? selected.message : describe(selected), 'warning'); return;
        }
        const available = selected.choices;
        const labels = available.map(item => `${item.branch} — ${item.worktree}`);
        const label = await ctx.ui.select('Existing Git worktree', labels);
        if (!label) return;
        const choice = available[labels.indexOf(label)];
        if (!choice) return;
        const opened = await nativeOpeningNode(installation, ctx.cwd, { project: choice.project, worktree: choice.worktree });
        if (opened.ok) { ctx.ui.notify(describe(opened.value), 'info'); return; }
        if (opened.error.state !== 'observed-conflict') { ctx.ui.notify(describe(opened.error), 'error'); return; }
        const proceed = await ctx.ui.select(opened.error.message, ['Cancel', 'Open another session explicitly']);
        if (proceed !== 'Open another session explicitly') return;
        const confirmed = await nativeOpeningNode(installation, ctx.cwd,
          { project: choice.project, worktree: choice.worktree, allowObservedSession: true });
        ctx.ui.notify(describe(confirmed.ok ? confirmed.value : confirmed.error), confirmed.ok ? 'info' : 'error');
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? describe({ message: error.message,
          ...(error && typeof error === 'object' && 'status' in error ? {
            status: error.status, stage: 'stage' in error ? error.stage : undefined,
            tabId: 'tabId' in error ? error.tabId : undefined, paneId: 'paneId' in error ? error.paneId : undefined,
            herdrSocketPath: 'herdrSocketPath' in error ? error.herdrSocketPath : undefined,
          } : {}),
        }) : String(error), 'error');
      }
    },
  });
  pi.registerTool({
    name: 'mypi_project_open', label: 'Open mypi project',
    description: 'List registered project/worktree candidates or open an explicit existing project and absolute worktree in a new Herdr tab. Never creates a worktree or request. Opening another session despite an observed session requires prior explicit operator approval; an ordinary request to open a project is not that approval.',
    parameters: Type.Object({ project: Type.Optional(Type.String()), worktree: Type.Optional(Type.String()),
      allowObservedSession: Type.Optional(Type.Boolean({ description: 'Set true only after prior explicit operator approval to open another session despite an observed session. An ordinary project-open request is not approval; otherwise leave false/omit and report the conflict.' })) }),
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      try {
        if (signal?.aborted) throw new Error('Opening cancelled before effects');
        const response = await nativeOpeningNode(installation, ctx.cwd,
          { project: params.project, worktree: params.worktree, allowObservedSession: params.allowObservedSession }, signal);
        const result = response.ok ? response.value : response.error;
        return { content: [{ type: 'text' as const, text: describe(result) }], details: result,
          ...(response.ok ? {} : { isError: true }) };
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
