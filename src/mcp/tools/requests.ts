import { z } from 'zod';
import { text, textInput, artifact } from '../schemas.js';
export const requests = {
  request_list: { schema: z.strictObject({ project: text.optional(), status: text.optional() }), description: 'List requests, optionally by org/project and current DB status.' },
  request_show: { schema: z.strictObject({ key: text }), description: 'Read DB card by CODE-number or REQ-number; source/artifacts via context_read.' },
  request_create: { schema: z.strictObject({ project: text.nullable(), title: text, status: text, slug: text,
    source: textInput, adoptSource: z.boolean().optional() }), description: 'Create request with explicit DB status and exact source. Project null means standalone REQ. adoptSource only after partial reconciliation. No execution.' },
  request_status: { schema: z.strictObject({ key: text, status: text, reason: text }), description: 'Change status and record reason. No terminal reopen; same status is a no-op.' },
  request_title: { schema: z.strictObject({ key: text, title: text, reason: text }), description: 'Change title with reason; key and directory remain unchanged.' },
  request_progress: { schema: z.strictObject({ key: text, text, artifacts: z.array(artifact).optional() }), description: 'Record outcome and optional artifacts relative to request directory; absent artifact text references an existing file. No overwrite or blind retry.' },
  request_touch: { schema: z.strictObject({ key: text }), description: 'Explicitly complete activity timestamp after reconciling partial; no fabricated status change.' },
  status_list: { schema: z.strictObject({}), description: 'Read live status dictionary; do not assume a fixed enum or workflow.' },
  status_add: { schema: z.strictObject({ code: text, terminal: z.boolean() }), description: 'Add DB status; explicit terminal flag, no default pipeline.' },
  status_rename: { schema: z.strictObject({ code: text, newCode: text }), description: 'Rename status preserving its stable ID and request references.' },
  status_terminal: { schema: z.strictObject({ code: text, terminal: z.boolean() }), description: 'Change terminal flag only on an unused status.' },
  status_remove: { schema: z.strictObject({ code: text }), description: 'Delete only an unused status.' },
};
