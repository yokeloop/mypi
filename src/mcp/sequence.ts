import type { AppCommand } from '../app/commands.js';
import { PartialError } from '../shared/context.js';

export async function runSequence(commands: AppCommand[], execute: (command: AppCommand) => Promise<unknown>): Promise<unknown> {
  const parts = commands.map(command => command.name.replace(/^task_/, ''));
  const saved: string[] = [];
  let result: unknown, taskId: number | undefined, contextDir: string | undefined;
  for (const [index, command] of commands.entries()) {
    try {
      result = await execute(command);
    } catch (error) {
      if (index === 0) throw error;
      const part = parts[index]!, rest = parts.slice(index + 1);
      const prefix = 'task_update stopped at ' + part + ' after saving ' + saved.join(', ') + ': ';
      if (error instanceof PartialError) throw new PartialError(prefix + error.message, [...saved, ...error.saved],
        [...error.missing, ...rest], error.paths, error.taskId ?? taskId);
      const message = error instanceof Error ? error.message : String(error);
      throw new PartialError(prefix + message, saved, [part, ...rest], contextDir === undefined ? [] : [contextDir], taskId);
    }
    saved.push(parts[index]!);
    if (typeof result === 'object' && result !== null && 'id' in result && typeof result.id === 'number'
      && 'contextDir' in result && typeof result.contextDir === 'string') {
      taskId = result.id; contextDir = result.contextDir;
    }
  }
  return result;
}
