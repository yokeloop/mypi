import type { Installation } from './installation.js';
import { createSessionCards } from './session-cards.js';
import type { SessionList } from './session-cards.js';
import type { PiLaunchPlan } from './pi-launcher.js';
import type { HerdrSubmission } from './herdr.js';
import { nativeStartupObservation } from './native-startup-match.js';
import { readPiExitMarker } from '../infrastructure/filesystem/pi-launch-exit.js';

/** Optional cache cannot silently be enabled; timeout leaves the submitted tab for inspection. */
export async function awaitNativePiStartup(receipt: HerdrSubmission, plan: PiLaunchPlan,
  installation: Installation, token: string, env: NodeJS.ProcessEnv, exitPath?: string,
  observe?: { list: () => SessionList; exit: () => number | 'unavailable' | undefined;
    now: () => number; wait: () => Promise<void> }): Promise<HerdrSubmission> {
  if (env['MYPI_SESSION_CARDS'] === '0') return { ...receipt, observation: 'disabled' };
  let source = observe;
  if (!source) {
    try {
      const cards = createSessionCards({ env, contextRoot: installation.homeRoot });
      source = { list: () => cards.list({ all: true, includeArchived: true }),
        exit: () => exitPath === undefined ? undefined : readPiExitMarker(exitPath),
        now: Date.now, wait: () => new Promise<void>(resolve => setTimeout(resolve, 200)) };
    } catch { return { ...receipt, observation: 'unavailable' }; }
  }
  const deadline = source.now() + 8000;
  let unavailable = false;
  do {
    const exitCode = source.exit();
    if (exitCode === 'unavailable') unavailable = true;
    else if (exitCode !== undefined) return { ...receipt, status: 'failed', exitCode, observation: exitCode === 0 ? 'exited' : 'exit-nonzero' };
    try {
      const observation = nativeStartupObservation(source.list(), receipt, plan, token);
      if (observation === 'ready') return { ...receipt, status: 'ready', observation: 'confirmed' };
      if (observation === 'closed') return { ...receipt, status: 'failed', observation: 'closed' };
      if (observation === 'unavailable') unavailable = true;
    } catch { unavailable = true; }
    if (source.now() >= deadline) break;
    await source.wait();
  } while (true);
  return { ...receipt, observation: unavailable ? 'unavailable' : 'timeout' };
}
