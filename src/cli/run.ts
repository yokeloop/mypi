import { executeCommand } from '../app/execute-command.js';
import type { TrustedExecutionContext } from '../app/execution-context.js';
import type { Command } from './command.js';
import { usage } from './command.js';
import { appCommand } from './app-command.js';
import { InputError } from '../shared/errors.js';

export async function run(command: Command, filename: string, root?: string, context?: TrustedExecutionContext): Promise<unknown> {
  if (command.type === 'help') return { usage };
  // Translation can read host files. Scoped callers must supply diagnostic text
  // until MP-9 can route file inputs through a resource-authorized boundary.
  if (context !== undefined && !(command.type === 'workspace'
    && ['policy validate', 'policy explain', 'policy preview'].includes(command.name)
    && command.options['file'] === undefined)) {
    throw new InputError('Scoped command dispatch unavailable until resource enforcement is implemented (MP-9)');
  }
  return executeCommand(appCommand(command), filename, root, context);
}
