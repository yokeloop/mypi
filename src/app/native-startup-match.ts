import type { SessionList } from './session-cards.js';
import type { PiLaunchPlan } from './pi-launcher.js';
import type { HerdrSubmission } from './herdr.js';

/** Fresh correlated extension session-start observation, not a rendered TUI frame. */
export function nativeStartupObservation(inventory: SessionList, receipt: HerdrSubmission,
  plan: PiLaunchPlan, token: string): 'ready' | 'closed' | 'unavailable' | 'pending' {
  if (inventory.truncated || inventory.issues.length) return 'unavailable';
  for (const { card, status } of inventory.sessions) {
    if (card.launchToken !== token || !card.nativeSessionId || card.cwd !== plan.cwd
      || card.herdrSocketPath !== receipt.herdrSocketPath || card.herdrTabId !== receipt.tabId
      || card.herdrPaneId !== receipt.paneId
      || JSON.stringify(card.context) !== JSON.stringify(plan.context?.context)) continue;
    if (card.state === 'closed') return 'closed';
    if (status !== 'stale' && status !== 'unknown') return 'ready';
  }
  return 'pending';
}
