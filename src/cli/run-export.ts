// Internal bounded export service; no worker calls or arbitrary command strings.
import { exportInsideService } from '../app/run-control.js';
try {
  if (process.argv.length !== 5) throw new Error('Export arguments required');
  process.stdout.write(JSON.stringify(exportInsideService(process.argv[2]!, process.argv[3]!, process.argv[4]!)) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
