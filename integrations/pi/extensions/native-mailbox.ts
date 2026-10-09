import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createMailbox } from '../../../dist/src/app/mailbox.js';
import { createMailboxDelivery } from '../../../dist/src/app/mailbox-delivery.js';

/** No resources at factory time; each session start supplies its own live public getter. */
export function registerNativeMailbox(pi: ExtensionAPI) {
  const delivery = createMailboxDelivery({
    env: process.env,
    receiver: id => createMailbox().receiver(id),
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
