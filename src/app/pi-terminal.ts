import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnPi } from '../infrastructure/process/pi-terminal.js';
import { herdrRunner, resolvePiExecutable } from '../infrastructure/process/herdr.js';
import { InputError } from '../shared/errors.js';
import { createApp } from './create-app.js';
import { installationEnvironment, resolveInstallation } from './installation.js';
import { encodePiContext, MYPI_PI_CONTEXT, MYPI_MCP_CONTEXT } from './pi-context.js';
import { MYPI_MCP_NATIVE_SESSION_ID } from './pi-message-caller.js';
import { preparePiLaunch, piLaunchObservations } from './pi-launcher.js';
import type { PiLaunchOptions, PiLaunchPlan } from './pi-launcher.js';
import { createRepositoryBindings } from './repository-bindings.js';
import { createSessionCards } from './session-cards.js';
import { controlHerdrSession, openHerdrPi } from './herdr.js';
import type { HerdrControl, HerdrSubmission } from './herdr.js';

/** Terminal-only composition: keep subprocess imports out of parsing and ordinary command dispatch. */
export async function launchPi(options: PiLaunchOptions): Promise<{ code: number | null; signal: NodeJS.Signals | null } | HerdrSubmission> {
  if (options.title !== undefined && !options.herdrTab) throw new InputError('--title requires --herdr-tab');
  const engineRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const installation = resolveInstallation(engineRoot, process.env);
  let plan: PiLaunchPlan;
  if (options.selection?.kind === 'project' || options.selection?.kind === 'organization') {
    const app = createApp(installation.database, true);
    try {
      plan = preparePiLaunch(options, process.cwd(), { projects: app.projects,
        repositories: createRepositoryBindings(app.projects, engineRoot) });
    } finally { app.close(); }
  } else plan = preparePiLaunch(options, process.cwd());
  let inventory;
  try {
    const cards = createSessionCards({ env: installationEnvironment(installation, process.env), contextRoot: installation.homeRoot });
    inventory = cards.list({ all: true, includeArchived: true });
    if (!existsSync(join(cards.directory, 'cards'))) inventory.issues.push({ issue: 'missing' });
  }
  catch { inventory = { sessions: [], issues: [{ issue: 'unavailable' as const }], truncated: false }; }
  const observations = piLaunchObservations(plan.cwd, inventory, options.allowObservedSession);
  if (observations.incomplete) process.stderr.write('mypi: session cache incomplete/unavailable; absence of duplicates is not established.\n');
  if (observations.requiresChoice) {
    throw new InputError('Known session observations for this worktree: ' + JSON.stringify(observations.conflicts)
      + '. Choose session focus <key> --all, another --cwd, or explicit --allow-observed-session. Stale/unknown is not death.');
  }
  const env = installationEnvironment(installation, process.env);
  delete env[MYPI_PI_CONTEXT];
  delete env[MYPI_MCP_CONTEXT];
  delete env[MYPI_MCP_NATIVE_SESSION_ID];
  if (plan.context) env[MYPI_PI_CONTEXT] = encodePiContext(plan.context);
  const extension = fileURLToPath(new URL('../../../integrations/pi/extensions/mypi.ts', import.meta.url));
  if (options.herdrTab) return openHerdrPi(plan, resolvePiExecutable(env, process.cwd()), extension, env, herdrRunner(env), options.title);
  return spawnPi(['--extension', extension, ...plan.args], plan.cwd, env);
}

export function controlSessionTerminal(command: HerdrControl) {
  // The fresh-launch handoff is not current native branch context for an independent CLI.
  const installation = resolveInstallation(fileURLToPath(new URL('../../../', import.meta.url)), process.env);
  return controlHerdrSession(command, process.env, herdrRunner(process.env),
    createSessionCards({ env: installationEnvironment(installation, process.env), contextRoot: installation.homeRoot }));
}
