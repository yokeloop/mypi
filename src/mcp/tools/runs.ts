import { z } from 'zod';
const id = z.string().regex(/^[a-f0-9]{32}$/);
export const runs = {
  run_start: { schema: z.strictObject({ key: z.string().min(1), seconds: z.number().int().min(10).max(86400),
    modelCalls: z.number().int().min(1).max(1000), fixture: z.boolean(), model: z.string().optional(), resume: id.optional(),
    deriveArtifact: z.string().regex(/^[a-z0-9]{6,16}$/).optional(), deriveWorkspace: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional() }),
    description: 'Trusted-host operation: explicitly launch the interactive flow in a scoped Herdr task tab. Does not create or complete a task. Live model calls require explicit authorization and budget. Never retry a partial launch blindly.' },
  run_export: { schema: z.strictObject({ id }), description: 'Trusted-host operation: after verified stop, import private Git object data and CAS only the assigned branch. No push, merge or acceptance. Inspect partial effects before retry.' },
  run_show: { schema: z.strictObject({ id }), description: 'Read authoritative run binding; process state is not task acceptance.' },
  run_list: { schema: z.strictObject({ key: z.string().min(1) }), description: 'List runs for one explicit task.' },
  run_stop: { schema: z.strictObject({ id }), description: 'Trusted-host operation: revoke a run and stop its owned service, never finish the task.' },
  run_reconcile: { schema: z.strictObject({ id }), description: 'Reconcile one run with the actual owned service after partial/exit/crash. No relaunch.' },
};
