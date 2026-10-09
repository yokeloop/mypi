import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnPi } from '../infrastructure/process/pi-terminal.js';
import { createApp, resolveStatePath } from './create-app.js';
import { encodePiContext, MYPI_PI_CONTEXT } from './pi-context.js';
import { preparePiLaunch } from './pi-launcher.js';
import type { PiLaunchOptions, PiLaunchPlan } from './pi-launcher.js';
import { createRepositoryBindings } from './repository-bindings.js';

/** Terminal-only composition: keep subprocess imports out of parsing and ordinary command dispatch. */
export async function launchPi(options: PiLaunchOptions): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const engineRoot = fileURLToPath(new URL('../../../', import.meta.url));
  let plan: PiLaunchPlan;
  if (options.selection?.kind === 'project' || options.selection?.kind === 'organization') {
    const app = createApp(resolveStatePath(process.env, homedir()), true);
    try {
      plan = preparePiLaunch(options, process.cwd(), { projects: app.projects,
        repositories: createRepositoryBindings(app.projects, engineRoot) });
    } finally { app.close(); }
  } else plan = preparePiLaunch(options, process.cwd());
  const env = { ...process.env };
  delete env[MYPI_PI_CONTEXT];
  if (plan.context) env[MYPI_PI_CONTEXT] = encodePiContext(plan.context);
  const extension = fileURLToPath(new URL('../../../integrations/pi/extensions/mypi.ts', import.meta.url));
  return spawnPi(['--extension', extension, ...plan.args], plan.cwd, env);
}
