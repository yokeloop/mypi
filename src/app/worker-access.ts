import { executeCommand } from './execute-command.js';
import { taskBinding, withRuns } from './run-records.js';
import { deriveCommand } from './derive-command.js';
import type { DeriveGrant } from './derive-command.js';
import { workerCommand } from './worker-command.js';

// Constructed only by the trusted per-run listener, never from a request payload.
export function workerAccess(filename: string, id: string, root?: string,
  derive?: { grant: DeriveGrant; invoke(request: { name: string; arguments: Record<string, unknown> }): Promise<unknown> }) {
  let pending: Promise<unknown> = Promise.resolve();
  return (name: string, input: unknown): Promise<unknown> => {
    const call = pending.then(async () => {
      const run = withRuns(filename, true, runs => runs.active(id));
      const { card, grant } = taskBinding(filename, run.requestKey, root);
      if (card.id !== run.requestId) throw new Error('Request binding changed');
      if (derive && name.startsWith('derive_')) return derive.invoke(deriveCommand(derive.grant, name, input));
      return executeCommand(workerCommand(grant, name, input), filename, root);
    });
    // Errors/partials are returned once, never retried. Following calls still recheck revocation.
    pending = call.catch(() => undefined);
    return call;
  };
}
