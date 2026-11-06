import { z } from 'zod';
import type { AppCommand, Artifact } from '../../app/commands.js';
import { text, textInput, artifact, tool } from '../schemas.js';
export const tasks = {
  task_list: tool(z.strictObject({ project: text.optional(), status: text.optional() }), 'Call to find tasks: lists task cards, optionally by org/project and current status code. Read-only; source and history are read with context_read and journal.',
    a => [{ name: 'task_list', ...a } as AppCommand]),
  task_show: tool(z.strictObject({ key: text }), 'Call to read one task card by key (CODE-number, or a legacy REQ-number), including status and worktreePath. Read-only; source and artifacts are files read with context_read.',
    a => [{ name: 'task_show', ...a } as AppCommand]),
  task_create: tool(z.strictObject({ project: text, title: text, status: text, slug: text,
    source: textInput, adoptSource: z.boolean().optional(), parent: text.optional() }), 'Call when the user asks to register a task: creates a task of a registered org/project with an explicit status code, slug and exact source. parent (optional) is the key of a parent task of the same project. adoptSource only after partial reconciliation. Does not plan or execute the work and creates no branch or worktree.',
  a => [{ name: 'task_create', ...a } as AppCommand]),
  task_update: tool(z.strictObject({ key: text, status: text.optional(), title: text.optional(), parent: text.nullable().optional(), reason: text.optional(),
    progress: text.optional(), artifacts: z.array(artifact).optional(), touch: z.literal(true).optional() }).superRefine((value, ctx) => {
    const change = value.status !== undefined || value.title !== undefined || value.parent !== undefined;
    if (!change && value.progress === undefined && value.touch === undefined)
      ctx.addIssue({ code: 'custom', path: [], message: 'task_update needs status, title, parent, progress or touch' });
    if (change && value.reason === undefined)
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason is required with status, title or parent' });
    if (!change && value.reason !== undefined)
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason is allowed only with status, title or parent' });
    if (value.artifacts !== undefined && value.progress === undefined)
      ctx.addIssue({ code: 'custom', path: ['artifacts'], message: 'artifacts require progress' });
    if (value.touch !== undefined && (change || value.progress !== undefined))
      ctx.addIssue({ code: 'custom', path: ['touch'], message: 'touch is allowed only alone' });
  }), 'Call to change a task in one call: status, title and/or parent (a task key of the same project, or null to clear) with a reason, progress text with optional artifacts (paths relative to the task folder; an artifact without text references an existing file; progress commits the named files in home (no push) and records each as {path, commit}), or touch:true alone to mark activity. Applies status, then title, then parent, then progress; if a later part fails after an earlier one saved, the result is partial with the saved and missing parts. Does not reopen terminal tasks, overwrite artifacts, retry, or create branches or worktrees; the same status is a no-op; parent is refused for another project, the task itself or a cycle. A status change to review, blocked, merged or a terminal status queues a milestone event (inbox, warmup) for the parent that last sent the task a message, else the project chat, unless that recipient itself makes it; milestones never start a turn.',
  ({ key, status, title, parent, reason, progress, artifacts, touch }) => {
    const commands: AppCommand[] = [];
    if (status !== undefined) commands.push({ name: 'task_status', key, status, reason: reason! });
    if (title !== undefined) commands.push({ name: 'task_title', key, title, reason: reason! });
    if (parent !== undefined) commands.push({ name: 'task_parent', key, parent, reason: reason! });
    if (progress !== undefined) commands.push({ name: 'task_progress', key, text: progress, artifacts: (artifacts ?? []) as Artifact[] });
    if (touch) commands.push({ name: 'task_touch', key });
    return commands;
  }),
};
