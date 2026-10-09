import { executeCommand } from '../app/execute-command.js';
import type { WorkContext } from '../app/commands.js';
import type { Command } from './command.js';
import { usage } from './command.js';
import { appCommand } from './app-command.js';

export async function run(command: Command, filename: string, root?: string, context?: WorkContext): Promise<unknown> {
  if (command.type === 'help') return { usage };
  return executeCommand(appCommand(command), filename, root, context);
}
