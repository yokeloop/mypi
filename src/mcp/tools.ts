import type { AppCommand } from '../app/commands.js';
import { InputError } from '../shared/errors.js';
import { projects } from './tools/projects.js';
import { knowledge } from './tools/knowledge.js';
import { tasks } from './tools/tasks.js';
import { maintenance } from './tools/maintenance.js';

export const tools = { ...projects, ...knowledge, ...tasks, ...maintenance };
export type ToolName = keyof typeof tools;
export const readOnly = new Set<ToolName>(['project_list', 'project_resolve', 'warmup', 'memory_show',
  'journal_read', 'task_list', 'task_show', 'status_list', 'context_read']);
export function toolCommand(name: string, args: unknown, env: Readonly<Record<string, string | undefined>> = {}): AppCommand {
  if (!Object.hasOwn(tools, name)) throw new InputError('Unknown tool: ' + name);
  const parsed = tools[name as ToolName].schema.parse(args);
  // Both adapters target AppCommand; the process environment supplies only warmup's default scope.
  const envScope = name === 'warmup' ? env['MYPI_SCOPE'] : undefined;
  return { name, ...parsed, ...(envScope === undefined ? {} : { envScope }) } as AppCommand;
}
