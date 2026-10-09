#!/usr/bin/env node
import { PartialError } from '../shared/context.js';
import { homedir } from 'node:os';
import { resolveStatePath } from '../app/create-app.js';
import { parseCommand, usage } from './command.js';
import { run } from './run.js';
import { launchPi } from '../app/pi-terminal.js';

try {
  const command = parseCommand(process.argv.slice(2));
  if (command.type === 'pi') {
    const result = await launchPi(command);
    if (result.signal) process.kill(process.pid, result.signal);
    else process.exitCode = result.code ?? 1;
  } else {
    // Help must work without a configured home, initialized DB or any filesystem changes.
    const output = command.type === 'help' ? { usage } : await run(command,
      resolveStatePath(process.env, homedir()));
    process.stdout.write(JSON.stringify(output) + '\n');
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ ...(error instanceof PartialError ? { status: 'partial', saved: error.saved,
    missing: error.missing, paths: error.paths, requestId: error.requestId,
    ...(error.home === undefined ? {} : { home: error.home }) } : { status: 'error' }), message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
