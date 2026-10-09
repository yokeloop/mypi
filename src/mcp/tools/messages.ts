import { z } from 'zod';
import { MESSAGE_MAX_TTL, MESSAGE_TEXT_BYTES } from '../../app/mailbox.js';

const messageId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const nativeId = z.string().min(1).max(256).regex(/^[^\x00-\x1f\x7f]+$/);
const address = { receiverNativeSessionId: nativeId };
const selected = z.strictObject({ ...address, messageId });
export const messages = {
  message_send: {
    schema: z.strictObject({ instanceKey: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
      messageId, text: z.string().min(1).refine(value => Buffer.byteLength(value) <= MESSAGE_TEXT_BYTES, 'Text exceeds 16KiB UTF-8'),
      ttlMs: z.number().int().positive().max(MESSAGE_MAX_TTL).optional() }),
    description: 'Queue text to the native Pi ID in an explicit session observation, including stale/closed/archived observations. Same ID and payload is a duplicate; changed payload conflicts. Cross-project messages are allowed with origin labels. No process/tab or model turn starts. Caller metadata is ordinary, unauthenticated integration input.',
  },
  message_list: { schema: z.strictObject(address),
    description: 'List a bounded local mailbox by literal native Pi session ID (not instance key). Issues/truncation mean incomplete inventory. Queued is not delivered; handed-to-pi is not read/executed or durable history.' },
  message_show: { schema: selected,
    description: 'Inspect one local message, including original sender/project labels and timestamps. A claim without a successful outcome stays uncertain; no automatic reinjection.' },
  message_cleanup: { schema: selected,
    description: 'Explicitly delete one handed-to-Pi or expired unclaimed mailbox record. Uncertain claims are never deleted, even after expiry. Deletion forgets dedup evidence, not native history. No waiting, reclaim or automatic cleanup.' },
};
