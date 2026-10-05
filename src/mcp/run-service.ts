// Internal trusted service entry, not an additional user-controlled shell API.
import { connectDerive } from './derive-client.js';
import { serveRun } from '../app/run-service.js';
try {
  if (process.argv.length !== 5) throw new Error('Service arguments required');
  await serveRun(process.argv[2]!, process.argv[3]!, process.argv[4]!, connectDerive);
} catch (error) {
  process.stderr.write(JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
