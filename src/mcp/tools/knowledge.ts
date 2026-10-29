import { z } from 'zod';
import type { AppCommand } from '../../app/commands.js';
import { text, scope, contextScope, textInput, tool, actions } from '../schemas.js';
export const knowledge = {
  warmup: tool(z.strictObject({ scope: text.optional() }), 'Call at session start or to reload context: returns the scoped startup context as Markdown (personal instructions, role, how to work in mypi, zone memory, then the project list, open tasks with new events and last reports, or the task card with its worktree). scope: global, a project code (MP) or a task key (MP-12); default: this session\'s registered key, else MYPI_SCOPE of the server, else global. In a project scope it includes the undelivered events of the project\'s tasks and marks the shown ones delivered, plus the last reports as history; it writes nothing else and registers no session.',
    a => [{ name: 'warmup', ...a } as AppCommand]),
  memory: tool(actions('action', { show: { required: ['scope'] }, add: { required: ['scope', 'text'] },
    remove: { required: ['scope', 'number', 'expectedRevision'] } },
  { scope: contextScope, text, number: z.number().int().positive(), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) }),
  'Call to read or change MEMORY facts at one level: action show (facts of this level only, not inherited, with revision), add (text; commits in home) or remove (number and expectedRevision from a fresh show; number is not a stable ID). scope: global, org or project, never task. Does not push or edit other files.',
  a => {
    switch (a.action) {
      case 'show': return [{ name: 'memory_show', scope: a.scope! }];
      case 'add': return [{ name: 'memory_add', scope: a.scope!, text: a.text! }];
      case 'remove': return [{ name: 'memory_remove', scope: a.scope!, number: a.number!, expectedRevision: a.expectedRevision! }];
    }
  }),
  note: tool(actions('kind', { note: { required: ['scope', 'title', 'body'] }, journal: { required: ['scope', 'text'] },
    error: { required: ['project', 'text'] }, capture: { required: ['source'] } },
  { scope, title: text, body: textInput, text, project: text, source: textInput }).superRefine((value, ctx) => {
    if (value.kind === 'note' && value.scope?.type === 'task')
      ctx.addIssue({ code: 'custom', path: ['scope'], message: 'Context scope cannot be task' });
  }),
  'Call to save one record when the user asks or the work requires it: kind note (scope, title, body) creates a new context note and commits; journal (scope, text; a task scope is allowed) records a factual outcome in SQLite; error (project org/project, text) appends a real failure or dead end to the project error log and commits; capture (source) stores exact text in the immutable global inbox. Never overwrites, never creates or executes a task, not idempotent: do not blindly retry.',
  a => {
    switch (a.kind) {
      case 'note': return [{ name: 'note_add', scope: a.scope!, title: a.title!, body: a.body! }];
      case 'journal': return [{ name: 'journal_add', scope: a.scope!, text: a.text! }];
      case 'error': return [{ name: 'error_add', project: a.project!, text: a.text! }];
      case 'capture': return [{ name: 'capture', source: a.source! }];
    }
  }),
  journal: tool(z.strictObject({ scope: z.union([scope, z.literal('all')]), from: text.optional(),
    to: text.optional(), eventType: z.enum(['note', 'task_created', 'status_changed']).optional(),
    limit: z.number().int().positive().optional() }), 'Call to read scoped history: scope (global means global entries only; "all" is explicit), optional from/to (UTC), eventType and limit. Prefer a limit; read artifacts with context_read. Read-only; outcomes are recorded with note kind journal.',
  a => [{ name: 'journal_read', ...a } as AppCommand]),
  context_read: tool(z.strictObject({ path: text }), 'Call to read a UTF-8 file by home-relative path (a task card is source.md in its task folder). Read-only, subject to path guards; not arbitrary filesystem access.',
    a => [{ name: 'context_read', ...a } as AppCommand]),
  context_write: tool(z.strictObject({ paths: z.array(text).min(1), message: text }), 'Call after reconciling named home files to commit exactly those files with a message. Does not commit directories or engine code, does not push, does not restore history.',
    a => [{ name: 'context_commit', ...a } as AppCommand]),
};
