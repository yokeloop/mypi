export type SetupField = 'homeRoot' | 'database' | 'stateRoot' | 'remote' | 'binding';
export interface SetupProblem {
  code: 'occupied' | 'missing' | 'invalid-path' | 'binding-invalid' | 'local-conflict' | 'refresh-required' | 'stale' | 'clone-aborted' | 'clone-uncertain' | 'unexpected';
  field?: SetupField;
  actions: readonly ('change' | 'reconcile' | 'refresh-preview' | 'inspect' | 'retry')[];
  message: string;
}
export class SetupError extends Error {
  constructor(public readonly code: SetupProblem['code'], message: string,
    public readonly field: SetupField | undefined, public readonly actions: SetupProblem['actions']) { super(message); this.name = 'SetupError'; }
}
export function setupProblem(error: unknown): SetupProblem {
  if (error instanceof SetupError) return { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}), actions: error.actions };
  return { code: 'unexpected', message: error instanceof Error ? error.message : String(error), actions: ['inspect'] };
}
