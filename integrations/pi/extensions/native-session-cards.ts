import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createSessionCards } from '../../../dist/src/app/session-cards.js';
import type { SessionObservation } from '../../../dist/src/app/session-cards.js';
import { createSessionLifecycle } from '../../../dist/src/app/session-lifecycle.js';
import { selectPiContext } from '../../../dist/src/app/pi-context.js';

function observation(ctx: ExtensionContext): SessionObservation {
  const manager = ctx.sessionManager;
  const selection = selectPiContext(manager.getBranch(), ctx.cwd);
  const nativeSessionFile = manager.getSessionFile();
  const title = manager.getSessionName();
  return { nativeSessionId: manager.getSessionId(), cwd: ctx.cwd, pid: process.pid,
    ...(nativeSessionFile !== undefined ? { nativeSessionFile } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(selection.state === 'selected' ? { context: selection.data.context } : {}),
  };
}

/** Register after native work context: its fresh launch handoff precedes observation. */
export function registerNativeSessionCards(pi: ExtensionAPI) {
  const lifecycle = createSessionLifecycle({ env: process.env, start: data => createSessionCards().start(data),
    schedule(callback, milliseconds) {
      const timer = setInterval(callback, milliseconds);
      timer.unref();
      return () => clearInterval(timer);
    },
  });
  pi.on('session_start', (_event, ctx) => {
    const notify = ctx.ui.notify.bind(ctx.ui);
    const warn = () => notify('mypi session observation unavailable; cache updates disabled until next session start.', 'warning');
    try {
      lifecycle.start(observation(ctx), ctx.isIdle() && !ctx.hasPendingMessages(), warn);
    } catch {
      lifecycle.fail();
      try { warn(); } catch { /* Optional UI is not required. */ }
    }
  });
  function refresh(event: 'heartbeat' | 'running' | 'settled', ctx: ExtensionContext): void {
    try { lifecycle.update(event, observation(ctx)); }
    catch { lifecycle.fail(); }
  }
  pi.on('session_tree', (_event, ctx) => refresh('heartbeat', ctx));
  pi.on('session_info_changed', (_event, ctx) => refresh('heartbeat', ctx));
  pi.on('before_agent_start', (_event, ctx) => refresh('heartbeat', ctx));
  pi.on('agent_start', (_event, ctx) => refresh('running', ctx));
  pi.on('agent_settled', (_event, ctx) => refresh('settled', ctx));
  pi.on('session_shutdown', () => lifecycle.close());
}
