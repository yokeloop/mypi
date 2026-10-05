import { InputError } from '../../shared/errors.js';
import type { RunPatch, RunState, RunStore, TaskRun } from './ports.js';
export type { RunPatch, RunState, RunStore, TaskRun } from './ports.js';

const transitions: Record<RunState, readonly RunState[]> = {
  prepared: ['starting', 'stopping', 'failed'], starting: ['running', 'stopping', 'failed'],
  running: ['stopping', 'stopped', 'failed'], stopping: ['stopped', 'failed'], stopped: [], failed: [],
};
export function runId(value: string): string {
  if (!/^[a-f0-9]{32}$/.test(value)) throw new InputError('Invalid run ID');
  return value;
}
export function serviceName(id: string): string { return 'mypi-run-' + runId(id) + '.service'; }
export function createRuns(store: RunStore, clock: () => string) {
  return {
    get: (id: string) => store.get(runId(id)), list: store.list,
    prepare(input: Pick<TaskRun, 'id' | 'requestId' | 'requestKey' | 'sessionId' | 'worktree' | 'baseRevision'> & { fixture?: boolean }) {
      runId(input.id); runId(input.sessionId);
      if (!/^[A-Z]+-[1-9][0-9]*$/.test(input.requestKey) || !/^[a-f0-9]{40,64}$/.test(input.baseRevision)
        || !input.worktree.startsWith('/') || input.worktree.includes('\0')) throw new InputError('Invalid run binding');
      return store.transaction(() => {
        const at = clock();
        const { fixture, ...binding } = input;
        const run: TaskRun = { ...binding, unit: fixture ? 'mypi-tests.service' : serviceName(input.id), state: 'prepared', pane: null, tab: null, invocation: null,
          sessionFile: null, createdAt: at, updatedAt: at, detail: '' };
        store.insert(run); return run;
      });
    },
    transition(id: string, expected: RunState, next: RunState, patch: RunPatch = {}) {
      return store.transaction(() => {
        const before = store.get(runId(id));
        if (before.state !== expected) throw new InputError('Run changed; inspect before retry');
        if (expected !== next && !transitions[expected].includes(next)) throw new InputError('Invalid run transition');
        if ((expected === 'stopped' || expected === 'failed') && expected === next) throw new InputError('Finished run is immutable');
        return store.update(id, next, clock(), patch);
      });
    },
    active(id: string) {
      const run = store.get(runId(id));
      if (run.state !== 'running') throw new InputError('Run grant is not active');
      return run;
    },
  };
}
