import { z } from 'zod';
import { EVENT_TYPES } from '../app/commands.js';
import type { OperationName } from '../app/commands.js';
import { ApiError } from './validate.js';

const text = z.string().min(1);
const positive = z.number().int().positive();
const agent = z.enum(['claude', 'pi']);
const identity = z.strictObject({ agent, nativeId: text });
const keyed = z.strictObject({ agent, nativeId: text, key: text });
const ids = z.array(positive);
const nativeId = z.string().min(1).max(256);
const offset = z.number().int().nonnegative();
const scopeInput = z.union([z.strictObject({ reference: text }), z.strictObject({ type: z.literal('global') }),
  z.strictObject({ type: z.enum(['org', 'project', 'task']), key: text })]);

export const operationInputs = {
  project_list: z.strictObject({ org: text.optional() }),
  project_add: z.strictObject({ identity: text, code: text, checkoutPath: text.optional(), repository: text }),
  project_update: z.strictObject({ identity: text, expectedCheckoutPath: text.nullable().optional(), checkoutPath: text.optional(),
    expectedRepository: text.nullable().optional(), repository: text.optional() }),
  project_resolve: z.strictObject({ path: text }),
  project_remove: z.strictObject({ identity: text, expectedCode: text }),
  org_remove: z.strictObject({ org: text }),
  status_list: z.strictObject({}),
  status_add: z.strictObject({ code: text, terminal: z.boolean() }),
  status_rename: z.strictObject({ code: text, newCode: text }),
  status_terminal: z.strictObject({ code: text, terminal: z.boolean() }),
  status_remove: z.strictObject({ code: text }),
  task_list: z.strictObject({ project: text.optional(), status: text.optional() }),
  task_show: z.strictObject({ key: text }),
  journal_read: z.strictObject({
    scope: z.union([z.literal('all'), scopeInput]),
    from: text.optional(), to: text.optional(), eventType: z.enum(EVENT_TYPES).optional(), limit: positive.optional(),
  }),
  event_list: z.strictObject({ to: text.optional(), from: text.optional(), kind: z.enum(['turn_end', 'waiting', 'milestone', 'message']).optional(),
    delivered: z.boolean().optional(), q: text.optional(), before: positive.optional(), limit: positive }),
  task_create: z.strictObject({ project: text, title: text, status: text, slug: text, parent: text.optional() }),
  task_status: z.strictObject({ key: text, status: text, reason: text, session: z.strictObject({ agent: z.enum(['claude', 'pi']), nativeId: text }).optional(),
    envScope: text.optional() }),
  task_title: z.strictObject({ key: text, title: text, reason: text }),
  task_parent: z.strictObject({ key: text, parent: text.nullable(), reason: text }),
  task_touch: z.strictObject({ key: text }),
  task_progress: z.strictObject({ key: text, text, artifacts: z.array(text).optional(), commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).optional() }),
  journal_add: z.strictObject({ scope: scopeInput, text }),
  context_guard: z.strictObject({ paths: z.array(text).optional() }),
  context_base: z.union([z.strictObject({ scope: scopeInput }), z.strictObject({ project: text })]),
  session_key: identity,
  session_save: z.strictObject({ agent, nativeId: text, device: text, candidateKey: text.nullable(), fork: z.boolean(), envScope: text.optional(),
    otherLive: z.array(keyed), own: z.array(keyed) }),
  session_forget_rows: z.strictObject({ key: text }),
  session_activate: z.strictObject({ agent, nativeId: text, claim: z.boolean() }),
  events_claim: z.strictObject({ key: text, live: z.array(identity), messagesOnly: z.boolean().optional() }),
  events_settle: z.strictObject({ sessionId: positive, acked: ids, released: ids }),
  event_create: z.strictObject({ from: text, kind: z.enum(['turn_end', 'waiting']), message: z.string(), to: text.optional() }),
  inbox_take: z.strictObject({ key: text, caller: identity.nullable() }),
  message_create: z.strictObject({ from: text, to: text, message: z.string() }),
  warmup_data: z.strictObject({ key: text }),
  events_mark: z.strictObject({ ids, caller: identity.nullable() }),
  archive_offset: z.strictObject({ agent, nativeId }),
  archive_record: z.strictObject({ agent, nativeId, path: text, expectedOffset: offset, newOffset: offset, read: z.strictObject({
    entries: z.array(z.strictObject({ entryId: text, parentEntryId: text.nullable(), at: z.string(), role: z.enum(['user', 'assistant']),
      origin: z.enum(['human', 'peer', 'task_notification', 'frame']), text })),
    name: z.string().nullable(), cwd: z.string().nullable(), parentNativeId: z.string().nullable() }) }),
  archive_status: z.strictObject({}),
  archive_search: z.strictObject({ q: z.string().optional(), scope: z.string().optional(), agent: z.enum(['claude', 'pi']).optional(),
    from: z.string().optional(), to: z.string().optional(), includePeer: z.boolean().optional(), limit: z.number().int().positive().optional() }),
  archive_show: z.strictObject({ id: z.number().int().positive().optional(), before: z.number().int().nonnegative().optional(),
    after: z.number().int().nonnegative().optional(), session: z.string().optional(), agent: z.enum(['claude', 'pi']).optional(),
    offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional(), includePeer: z.boolean().optional() }),
  archive_forget: z.strictObject({ session: z.string().optional(), key: z.string().optional(), before: z.string().optional() }),
} satisfies Record<OperationName, z.ZodType>;

export function parseOperation(op: string, input: unknown): { name: OperationName; input: unknown } {
  if (!Object.hasOwn(operationInputs, op)) throw new ApiError(400, 'invalid_request', 'Unknown operation: ' + op);
  const parsed = operationInputs[op as OperationName].safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new ApiError(400, 'invalid_request', 'Invalid input for ' + op + ': ' + issue.path.join('.') + ' ' + issue.message);
  }
  return { name: op as OperationName, input: parsed.data };
}
