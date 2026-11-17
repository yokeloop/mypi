import { z } from 'zod';
import { EVENT_TYPES } from '../app/commands.js';
import type { OperationName } from '../app/commands.js';
import { ApiError } from './validate.js';

const text = z.string().min(1);
const positive = z.number().int().positive();

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
    scope: z.union([z.literal('all'), z.strictObject({ reference: text }), z.strictObject({ type: z.literal('global') }),
      z.strictObject({ type: z.enum(['org', 'project', 'task']), key: text })]),
    from: text.optional(), to: text.optional(), eventType: z.enum(EVENT_TYPES).optional(), limit: positive.optional(),
  }),
  event_list: z.strictObject({ to: text.optional(), from: text.optional(), kind: z.enum(['turn_end', 'waiting', 'milestone', 'message']).optional(),
    delivered: z.boolean().optional(), q: text.optional(), before: positive.optional(), limit: positive }),
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
