import { executeCommand } from '../app/execute-command.js';
import type { EventTransports } from '../app/delivery.js';
import type { RunContext } from '../app/commands.js';
import type { Backend } from '../app/backend.js';
import type { Command } from './command.js';
import { usage } from './command.js';
import { appCommand } from './app-command.js';

export async function run(command: Command, filename: string, root?: string,
  env: Readonly<Record<string, string | undefined>> = {}, transports: EventTransports = {}, context: RunContext = {}, backend?: Backend): Promise<unknown> {
  if (command.type === 'help') return { usage };
  return executeCommand(appCommand(command, env), filename, root, transports, context, backend);
}
