#!/usr/bin/env node
import { PartialError } from '../shared/context.js';
import { CancelledError } from '../shared/errors.js';
import { homedir } from 'node:os';
import { resolveStatePath } from '../app/create-app.js';
import { eventTransports } from '../app/event-transports.js';
import { parseCommand, usage } from './command.js';
import { run } from './run.js';

let stoppedBy: 'SIGINT' | 'SIGTERM' | undefined;
try {
  const command = parseCommand(process.argv.slice(2));
  const cancellable = command.type === 'workspace' && command.name === 'open';
  let context = {};
  if (cancellable) {
    const controller = new AbortController();
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stoppedBy ??= sig; controller.abort(); });
    context = { signal: controller.signal, onProgress: (line: string) => process.stderr.write('mypi: ' + line + '\n') };
  }
  // Help must work without a configured home, initialized DB or any filesystem changes.
  const output = command.type === 'help' ? { usage } : await run(command,
    resolveStatePath(process.env, homedir()), undefined, process.env, eventTransports, context);
  if (output !== null && typeof output === 'object' && 'status' in output && (output.status === 'partial' || output.status === 'error')) {
    process.stderr.write(JSON.stringify(output) + '\n');
    process.exitCode = 1;
  } else if (typeof output === 'string') process.stdout.write(output);
  else process.stdout.write(JSON.stringify(output) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ ...(error instanceof PartialError ? { status: 'partial', saved: error.saved,
    missing: error.missing, paths: error.paths, taskId: error.taskId } : { status: 'error' }), message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = error instanceof CancelledError ? (stoppedBy === 'SIGINT' ? 130 : 143) : 1;
}
