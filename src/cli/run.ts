import { executeCommand } from '../app/execute-command.js';
import { createApp, initializeState } from '../app/create-app.js';
import type { Command } from './command.js';
import { usage } from './command.js';

export async function run(command: Command, filename: string): Promise<unknown> {
  if (command.type === 'workspace') return executeCommand(command, filename);
  if (command.type === 'help') return { usage };
  if (command.type === 'initialize') {
    initializeState(filename);
    return { status: 'ok', database: filename };
  }
  const app = createApp(filename, command.type === 'list');
  try {
    if (command.type === 'list') return { projects: app.projects.list(command.org) };
    return { project: app.projects.add(command.identity, command.code, command.checkoutPath) };
  } finally {
    app.close();
  }
}
