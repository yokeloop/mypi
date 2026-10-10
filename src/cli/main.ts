#!/usr/bin/env node
import { PartialError } from '../shared/context.js';
import { fileURLToPath } from 'node:url';
import { resolveInstallation, installationEnvironment } from '../app/installation.js';
import { parseCommand, usage } from './command.js';
import { run } from './run.js';
import { HerdrPartialError } from '../app/herdr.js';
import { controlSessionTerminal, launchPi } from '../app/pi-terminal.js';

try {
  const command = parseCommand(process.argv.slice(2));
  if (command.type === 'pi') {
    const result = await launchPi(command);
    if ('status' in result) process.stdout.write(JSON.stringify(result) + '\n');
    else if (result.signal) process.kill(process.pid, result.signal);
    else process.exitCode = result.code ?? 1;
  } else if (command.type === 'session-control') {
    process.stdout.write(JSON.stringify(controlSessionTerminal(command)) + '\n');
  } else {
    // Help must work without a configured home, initialized DB or any filesystem changes.
    const output = command.type === 'help' ? { usage } : await (async () => {
      const installation = resolveInstallation(fileURLToPath(new URL('../../../', import.meta.url)), process.env);
      return run(command, installation.database, installation.homeRoot, undefined,
        { env: installationEnvironment(installation, process.env), contextRoot: installation.homeRoot });
    })();
    process.stdout.write(JSON.stringify(output) + '\n');
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ ...(error instanceof HerdrPartialError ? { status: error.status, stage: error.stage, herdrSocketPath: error.herdrSocketPath,
    tabId: error.tabId, paneId: error.paneId } : error instanceof PartialError ? { status: 'partial', saved: error.saved,
    missing: error.missing, paths: error.paths, requestId: error.requestId,
    ...(error.home === undefined ? {} : { home: error.home }) } : { status: 'error' }), message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
