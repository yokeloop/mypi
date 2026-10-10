import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { Installation } from '../../../dist/src/app/installation.js';

const opening = () => import('../../../dist/src/app/project-opening-terminal.js');
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
        const api = await opening();
        const first = api.projectOpeningChoices(installation, project);
        if (!ctx.hasUI) { ctx.ui.notify(describe(first), 'warning'); return; }
        const selectedProject = project ?? (first.state === 'projects'
          ? await ctx.ui.select('Registered project', first.projects) : undefined);
        if (!selectedProject) { if (project) ctx.ui.notify(describe(first), 'warning'); return; }
        const selected = project ? first : api.projectOpeningChoices(installation, selectedProject);
        if (selected.state !== 'choices' || !selected.choices.length) {
          ctx.ui.notify(selected.state === 'choices' ? selected.message : describe(selected), 'warning'); return;
        }
        const available = selected.choices;
        const labels = available.map(item => `${item.branch} — ${item.worktree}`);
        const label = await ctx.ui.select('Existing Git worktree', labels);
        if (!label) return;
        const choice = available[labels.indexOf(label)];
        if (!choice) return;
        try {
          ctx.ui.notify(describe(await api.openProjectPi(installation, ctx.cwd, choice.project, choice.worktree)), 'info');
        } catch (error) {
          if (!(error instanceof api.ObservedSessionConflict)) throw error;
          const proceed = await ctx.ui.select(error.message, ['Cancel', 'Open another session explicitly']);
          if (proceed !== 'Open another session explicitly') return;
          ctx.ui.notify(describe(await api.openProjectPi(installation, ctx.cwd, choice.project, choice.worktree, true)), 'info');
        }
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
    description: 'List registered project/worktree candidates or open an explicit existing project and absolute worktree in a new Herdr tab. Never creates a worktree or request.',
    parameters: Type.Object({ project: Type.Optional(Type.String()), worktree: Type.Optional(Type.String()),
      allowObservedSession: Type.Optional(Type.Boolean()) }),
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      try {
        if (signal?.aborted) throw new Error('Opening cancelled before effects');
        const api = await opening();
        if (signal?.aborted) throw new Error('Opening cancelled before effects');
        const result = params.project && params.worktree
          ? await api.openProjectPi(installation, ctx.cwd, params.project, params.worktree, params.allowObservedSession)
          : api.projectOpeningChoices(installation, params.project, params.worktree);
        return { content: [{ type: 'text' as const, text: describe(result) }], details: result };
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
