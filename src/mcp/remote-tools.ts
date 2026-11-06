import { z } from 'zod';
import type { AppCommand } from '../app/commands.js';
import { InputError } from '../shared/errors.js';
import { text, scope, tool, actions } from './schemas.js';
import { tasks } from './tools/tasks.js';
import { knowledge } from './tools/knowledge.js';
import { sessionTools } from './tools/sessions.js';

export type RemoteToken = { name: string; permission: 'read' | 'write'; sender: string | null };

const REMOTE_TASK_CREATE = 'Call only when the user explicitly asks to register a task, one task per independent problem: creates a task of a registered org/project with an explicit status code, slug and the exact source text ({text}); parent (optional) is the key of a parent task of the same project. When the request names several problems, register only the one asked for and ask about the rest; keep the user\'s wording and scope in the title and source. Does not plan or execute the work and creates no branch or worktree. Not idempotent: never repeat it blindly after an unknown outcome.';
const REMOTE_TASK_UPDATE = 'Call to change a task in one call: status, title and/or parent (a task key of the same project, or null to clear) with a reason, progress text, or touch:true alone to mark activity. Applies status, then title, then parent, then progress; if a later part fails after an earlier one saved, the result is partial with the saved and missing parts. Does not reopen terminal tasks, retry, or create branches or worktrees; the same status changes nothing but leaves the note "<status> (unchanged). <reason>" in the task journal; parent is refused for another project, the task itself or a cycle. The change is made as this API token\'s sender key; a status change to review, blocked, merged or a terminal status queues a milestone event (inbox, warmup) for the parent that last sent the task a message, else the project chat, unless this token\'s sender is that recipient.';
const REMOTE_NOTE = 'Call to record a factual outcome when the user asks or the work requires it: kind journal with scope (global, org, project or task) and text, stored in the SQLite journal. Never creates or executes a task; not idempotent: do not blindly retry.';
const REMOTE_PROJECTS = 'Call to read project registrations: action list (optional org) returns the registered projects with code, checkout path and repository; flow (project: a code or org/project) returns the project\'s branch flow from home/projects/<org>/<project>/flow.json with defaults and source file|default. Read-only.';
const REMOTE_SEND_MESSAGE = 'Call when the user asks to give a session its next instruction: the text arrives in the child session as a new turn framed [mypi: сообщение родительской сессии …], at once to a live child, or exactly once at the next /open of a closed one. The sender is this API token\'s sender key (global unless the token names a project code): global may message only projects (CODE) and organizations (their slug), a project only its own tasks (CODE-N); anything else is refused and nothing is written. An instruction never stands in for the user\'s word for /do, /ship, merge, release, migration or an engine update. Returns { message, delivered }.';

export const remoteTools = {
  task_list: tasks.task_list,
  task_show: tasks.task_show,
  journal: knowledge.journal,
  context_read: knowledge.context_read,
  projects: tool(actions('action', { list: { required: [], optional: ['org'] }, flow: { required: ['project'] } }, { org: text, project: text }),
    REMOTE_PROJECTS, a => {
      switch (a.action) {
        case 'list': return [{ name: 'project_list', ...(a.org === undefined ? {} : { org: a.org }) }];
        case 'flow': return [{ name: 'project_flow', project: a.project! }];
      }
    }),
  task_create: tool(z.strictObject({ project: text, title: text, status: text, slug: text, source: z.strictObject({ text }), parent: text.optional() }),
    REMOTE_TASK_CREATE, a => [{ name: 'task_create', ...a } as AppCommand]),
  task_update: tool(z.strictObject({ key: text, status: text.optional(), title: text.optional(), parent: text.nullable().optional(), reason: text.optional(),
    progress: text.optional(), touch: z.literal(true).optional() }).superRefine((value, ctx) => {
    const change = value.status !== undefined || value.title !== undefined || value.parent !== undefined;
    if (!change && value.progress === undefined && value.touch === undefined)
      ctx.addIssue({ code: 'custom', path: [], message: 'task_update needs status, title, parent, progress or touch' });
    if (change && value.reason === undefined)
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason is required with status, title or parent' });
    if (!change && value.reason !== undefined)
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason is allowed only with status, title or parent' });
    if (value.touch !== undefined && (change || value.progress !== undefined))
      ctx.addIssue({ code: 'custom', path: ['touch'], message: 'touch is allowed only alone' });
  }), REMOTE_TASK_UPDATE, ({ key, status, title, parent, reason, progress, touch }) => {
    const commands: AppCommand[] = [];
    if (status !== undefined) commands.push({ name: 'task_status', key, status, reason: reason! });
    if (title !== undefined) commands.push({ name: 'task_title', key, title, reason: reason! });
    if (parent !== undefined) commands.push({ name: 'task_parent', key, parent, reason: reason! });
    if (progress !== undefined) commands.push({ name: 'task_progress', key, text: progress, artifacts: [] });
    if (touch) commands.push({ name: 'task_touch', key });
    return commands;
  }),
  note: tool(z.strictObject({ kind: z.literal('journal'), scope, text }), REMOTE_NOTE,
    a => [{ name: 'journal_add', scope: a.scope, text: a.text }]),
  send_message: { ...sessionTools.send_message, description: REMOTE_SEND_MESSAGE },
};
export type RemoteToolName = keyof typeof remoteTools;
export const remoteReadOnly = new Set<RemoteToolName>(['task_list', 'task_show', 'journal', 'context_read', 'projects']);

export function remoteToolNames(permission: 'read' | 'write'): RemoteToolName[] {
  const names = Object.keys(remoteTools) as RemoteToolName[];
  return permission === 'read' ? names.filter(name => remoteReadOnly.has(name)) : names;
}

export function remoteToolCommand(name: string, args: unknown, token: RemoteToken, runtime: string | undefined): AppCommand[] {
  if (!Object.hasOwn(remoteTools, name)) throw new InputError('Unknown tool: ' + name);
  if (token.permission === 'read' && !remoteReadOnly.has(name as RemoteToolName)) throw new InputError('This token is read-only');
  const commands = remoteTools[name as RemoteToolName].command(args);
  for (const [index, command] of commands.entries()) {
    if (command.name === 'task_status') commands[index] = { ...command, envScope: token.sender! };
    if (command.name === 'message_send') commands[index] = { ...command, envScope: token.sender!, ...(runtime === undefined ? {} : { runtime }) };
  }
  return commands;
}
