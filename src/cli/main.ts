#!/usr/bin/env node
import { PartialError } from '../shared/context.js';
import { homedir } from 'node:os';
import { resolveStatePath } from '../app/create-app.js';
import { parseCommand, usage } from './command.js';
import { run } from './run.js';

try {
  const command = parseCommand(process.argv.slice(2));
  // Help must work without a configured home, initialized DB or any filesystem changes.
  const output = command.type === 'help' ? { usage } : await run(command,
    resolveStatePath(process.env, homedir()));
  if (output !== null && typeof output === 'object' && 'status' in output && (output.status === 'partial' || output.status === 'error')) {
    process.stderr.write(JSON.stringify(output) + '\n');
    process.exitCode = 1;
  } else process.stdout.write(JSON.stringify(output) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ ...(error instanceof PartialError ? { status: 'partial', saved: error.saved,
    missing: error.missing, paths: error.paths, taskId: error.taskId } : { status: 'error' }), message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
