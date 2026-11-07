import type { AppCommand } from '../app/commands.js';
import { InputError } from '../shared/errors.js';
import { sessionHint } from '../app/session-input.js';
import { projects } from './tools/projects.js';
import { knowledge } from './tools/knowledge.js';
import { tasks } from './tools/tasks.js';
import { sessionTools } from './tools/sessions.js';
import { archiveTools } from './tools/archive.js';

export const tools = { ...projects, ...knowledge, ...tasks, ...sessionTools, ...archiveTools };
export type ToolName = keyof typeof tools;
export const readOnly = new Set<ToolName>(['task_list', 'task_show', 'journal', 'context_read', 'sessions', 'events', 'archive_search', 'archive_show']);
export function toolCommand(name: string, args: unknown, env: Readonly<Record<string, string | undefined>> = {},
  parentPid = process.ppid): AppCommand[] {
  if (!Object.hasOwn(tools, name)) throw new InputError('Unknown tool: ' + name);
  const commands = tools[name as ToolName].command(args);
  // Both adapters target AppCommand; the process environment supplies warmup's default scope and session, and the registry location, and open_session's caller and state.
  if (name === 'warmup' || name === 'inbox') {
    const envScope = env['MYPI_SCOPE'], session = sessionHint(env, parentPid);
    commands[0] = { ...commands[0], ...(envScope === undefined ? {} : { envScope }), ...(session === undefined ? {} : { session }) } as AppCommand;
  }
  if (name === 'task_update') {
    const envScope = env['MYPI_SCOPE'], session = sessionHint(env, parentPid);
    for (const [index, command] of commands.entries()) {
      if (command.name === 'task_status') {
        commands[index] = { ...command, ...(envScope === undefined ? {} : { envScope }), ...(session === undefined ? {} : { session }) };
      }
    }
  }
  if (name === 'open_session') {
    const envScope = env['MYPI_SCOPE'], session = sessionHint(env, parentPid);
    commands[0] = { ...commands[0], ...(session === undefined ? {} : { session }), ...(envScope === undefined ? {} : { envScope }),
      ...(env['XDG_STATE_HOME'] ? { stateHome: env['XDG_STATE_HOME'] } : {}),
      ...(env['XDG_RUNTIME_DIR'] ? { runtime: env['XDG_RUNTIME_DIR'] } : {}) } as AppCommand;
  }
  if (name === 'send_message') {
    const envScope = env['MYPI_SCOPE'], session = sessionHint(env, parentPid);
    commands[0] = { ...commands[0], ...(session === undefined ? {} : { session }), ...(envScope === undefined ? {} : { envScope }),
      ...(env['XDG_RUNTIME_DIR'] ? { runtime: env['XDG_RUNTIME_DIR'] } : {}) } as AppCommand;
  }
  if (name === 'sessions' && env['XDG_RUNTIME_DIR']) commands[0] = { ...commands[0], runtime: env['XDG_RUNTIME_DIR'] } as AppCommand;
  return commands;
}
