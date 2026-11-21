import { run } from '../../src/cli/run.js';
import { parseCommand } from '../../src/cli/command.js';
import { piEventSocket } from '../../src/infrastructure/socket/pi-event-socket.js';
import { useProcessProbe } from '../../src/app/create-app.js';
import { runPs } from '../../src/app/process-runner.js';

useProcessProbe(runPs);

const [filename, ...args] = process.argv.slice(2) as [string, ...string[]];
const output = await run(parseCommand(args), filename, undefined, process.env, { pi: (socket, events) => piEventSocket(socket, events, 200) });
process.stdout.write(JSON.stringify(output) + '\n');
