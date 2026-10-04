import { z } from 'zod';
import { text, scope, contextScope, textInput } from '../schemas.js';
export const knowledge = {
  warmup: { schema: z.strictObject({ scope: contextScope }), description: 'Read inherited memory and a scoped context index. Read full artifacts separately; no global inbox in org/project scope.' },
  memory_show: { schema: z.strictObject({ scope: contextScope }), description: 'Read facts at this level (not inherited memory).' },
  memory_add: { schema: z.strictObject({ scope: contextScope, text }), description: 'Add a fact and commit context.' },
  memory_remove: { schema: z.strictObject({ scope: contextScope, number: z.number().int().positive() }), description: 'Remove fact by current display number. Reread memory_show first; number is not a stable ID.' },
  capture: { schema: z.strictObject({ source: textInput }), description: 'Save exact source to immutable global inbox; does not create or execute a request.' },
  note_add: { schema: z.strictObject({ scope: contextScope, title: text, body: textInput }), description: 'Create a new context note and commit; never overwrite an earlier note.' },
  error_add: { schema: z.strictObject({ project: text, text }), description: 'Append a real failure/dead end to the org/project error log and commit.' },
  journal_read: { schema: z.strictObject({ scope: z.union([scope, z.literal('all')]), from: text.optional(),
    to: text.optional(), eventType: z.enum(['note', 'request_created', 'status_changed']).optional(),
    limit: z.number().int().positive().optional() }), description: 'Read scoped history with filters. Global is not all. Prefer a limit; read full artifacts when needed.' },
  journal_add: { schema: z.strictObject({ scope, text }), description: 'Append a factual outcome and commit. Not idempotent; do not blindly retry.' },
};
