import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createMailbox } from '../../../dist/src/app/mailbox.js';
import { createMailboxDelivery } from '../../../dist/src/app/mailbox-delivery.js';

/** No resources at factory time; each session start supplies its own live public getter. */
export function registerNativeMailbox(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env, contextRoot?: string) {
  const delivery = createMailboxDelivery({
    env,
    receiver: id => createMailbox({ env, contextRoot }).receiver(id),
    sendMessage: (message, options) => pi.sendMessage(message, options),
    schedule(callback, milliseconds) {
      const timer = setInterval(callback, milliseconds);
      timer.unref();
      return () => clearInterval(timer);
    },
  });
  pi.on('session_start', (_event, ctx) => {
    delivery.start(() => ctx.sessionManager.getSessionId(), () => {
      ctx.ui.notify('mypi mailbox encountered an incomplete/unavailable record or receiver. Inspect message list/show; uncertain claims are never resent. Receiver failure disables polling until the next session start.', 'warning');
    });
  });
  pi.on('session_shutdown', () => delivery.close());
}
