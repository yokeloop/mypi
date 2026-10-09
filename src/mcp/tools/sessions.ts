import { z } from 'zod';
import { parseSessionCard } from '../../app/session-cards.js';
import { externalPath, output } from '../schemas.js';

const key = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const project = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const selection = { project: project.optional(), all: z.boolean().optional() };
const exclusive = (value: { project?: string | undefined; all?: boolean | undefined }) => !(value.all && value.project !== undefined);
const selectedKey = z.strictObject({ ...selection, instanceKey: key }).refine(exclusive, 'Use project or all, not both');
export const sessions = {
  session_list: { schema: z.strictObject({ ...selection, includeArchived: z.boolean().optional() }).refine(exclusive, 'Use project or all, not both'),
    description: 'List bounded cache observations for the selected project, an explicit project, or explicit all-project view. Issues/truncation mean incomplete inventory; stale is not dead. No transcripts or registry lookup.' },
  session_show: { schema: selectedKey,
    description: 'Show one instance observation, including archived cards, using selected-project or explicit project/all filtering. Native session pointers are observations only; history is never read.' },
  session_archive: { schema: selectedKey,
    description: 'Idempotently hide one selected instance from normal lists. Later heartbeat does not undo archive. No native history deletion, process control or network access.' },
};
const context = z.strictObject({
  scope: z.union([z.strictObject({ kind: z.literal('project'), project }),
    z.strictObject({ kind: z.literal('organization'), organization: z.string() }),
    z.strictObject({ kind: z.literal('unrestricted') })]),
  selectedProject: project.optional(), worktreeRoot: externalPath.optional(),
});
const epoch = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const card = z.strictObject({ version: z.literal(1), instanceKey: key, nativeSessionId: z.string().min(1), cwd: externalPath,
  context: context.optional(), nativeSessionFile: externalPath.optional(), title: z.string().optional(),
  pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(), herdrTabId: z.string().min(1).optional(),
  herdrSocketPath: z.string().min(1).optional(), herdrPaneId: z.string().min(1).optional(),
  state: z.enum(['starting', 'running', 'idle', 'closed']), startedAt: epoch, lastSeen: epoch,
}).refine(value => parseSessionCard(value, value.instanceKey) !== undefined, 'Invalid session observation');
const view = z.strictObject({ card, archived: z.boolean(), ageMs: epoch.nullable(), status: z.enum(['starting', 'running', 'idle', 'closed', 'stale', 'unknown']) });
const issue = z.enum(['missing', 'invalid', 'unavailable']);
export const sessionResults = {
  session_list: z.strictObject({ sessions: z.array(view), issues: z.array(z.strictObject({ instanceKey: key.optional(), issue })), truncated: z.boolean() }),
  session_show: z.strictObject({ session: view.nullable(), issue: z.enum(['missing', 'invalid', 'unavailable', 'outside-selection']).optional() }),
  session_archive: z.strictObject({ instanceKey: key, archived: z.literal(true) }),
};
export function sessionResultSchema(name: string) {
  return Object.hasOwn(sessionResults, name) ? sessionResults[name as keyof typeof sessionResults] : undefined;
}
export function sessionOutputSchema(name: string) {
  const data = sessionResultSchema(name);
  return data ? output.extend({ data: data.optional() }) : output;
}
