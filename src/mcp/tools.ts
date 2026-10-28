import type { AppCommand } from '../app/commands.js';
import { InputError } from '../shared/errors.js';
import { projects } from './tools/projects.js';
import { knowledge } from './tools/knowledge.js';
import { tasks } from './tools/tasks.js';

export const tools = { ...projects, ...knowledge, ...tasks };
export type ToolName = keyof typeof tools;
export const readOnly = new Set<ToolName>(['warmup', 'task_list', 'task_show', 'journal', 'context_read']);
export function toolCommand(name: string, args: unknown, env: Readonly<Record<string, string | undefined>> = {}): AppCommand[] {
  if (!Object.hasOwn(tools, name)) throw new InputError('Unknown tool: ' + name);
  const commands = tools[name as ToolName].command(args);
  // Both adapters target AppCommand; the process environment supplies only warmup's default scope.
  const envScope = name === 'warmup' ? env['MYPI_SCOPE'] : undefined;
  if (envScope !== undefined) commands[0] = { ...commands[0], envScope } as AppCommand;
  return commands;
}
