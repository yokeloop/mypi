import { z } from 'zod';
import { text, tool } from '../schemas.js';
import type { AppCommand } from '../../app/commands.js';
export const archiveTools = {
  archive_search: tool(z.strictObject({ q: text.optional(), scope: text.optional(), agent: z.enum(['claude', 'pi']).optional(),
    from: text.optional(), to: text.optional(), includePeer: z.boolean().optional(), limit: z.number().int().positive().optional() }),
  'Call to find past conversations of mypi sessions (human turns and final answers of Claude and Pi) in the local archive: q (words; a trailing * matches a prefix) ranked by relevance with a snippet; scope (global, an org slug with its projects and their tasks, a project code with its tasks, a task key; default: all sessions), agent, from/to (YYYY-MM-DD or UTC), limit (10, at most 50), includePeer (also parent messages, task notifications and mypi frames). Without q it lists sessions with message counts (limit 50, at most 200). Each hit has id, agent, key, session, at, role, origin, snippet; read around it with archive_show. Read-only; the archive is filled by the CLI mypi archive import.',
    ({ includePeer, ...a }) => [{ name: 'archive_search', ...a, ...(includePeer ? { includePeer: true } : {}) } as AppCommand]),
  archive_show: tool(z.strictObject({ id: z.number().int().positive().optional(), before: z.number().int().nonnegative().optional(),
    after: z.number().int().nonnegative().optional(), session: text.optional(), agent: z.enum(['claude', 'pi']).optional(),
    offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().optional(), includePeer: z.boolean().optional() }),
  'Call to read the archive around a hit: id with before/after (3 each, at most 20), or a whole session by pages: session (native id from a hit or a listing), agent when both agents have that id, offset, limit (20, at most 50; next is the following offset or null). includePeer as in archive_search. Read-only.',
    ({ includePeer, ...a }) => [{ name: 'archive_show', ...a, ...(includePeer ? { includePeer: true } : {}) } as AppCommand]),
};
