import type { AppCommand } from '../app/commands.js';
import { InputError } from '../shared/errors.js';
import { projects } from './tools/projects.js';
import { knowledge } from './tools/knowledge.js';
import { requests } from './tools/requests.js';
import { runs } from './tools/runs.js';
import { maintenance } from './tools/maintenance.js';

export const tools = { ...projects, ...knowledge, ...requests, ...maintenance, ...runs };
export type ToolName = keyof typeof tools;
export const readOnly = new Set<ToolName>(['project_list', 'project_resolve', 'warmup', 'memory_show',
  'journal_read', 'request_list', 'request_show', 'status_list', 'context_read', 'run_show', 'run_list']);
export function toolCommand(name: string, args: unknown): AppCommand {
  if (!Object.hasOwn(tools, name)) throw new InputError('Unknown tool: ' + name);
  const parsed = tools[name as ToolName].schema.parse(args);
  // Both adapters target AppCommand; no argv conversion and no inferred current scope.
  return { name, ...parsed } as AppCommand;
}
