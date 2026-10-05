export type RunState = 'prepared' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
export interface TaskRun {
  id: string; unit: string; requestId: number; requestKey: string; sessionId: string;
  worktree: string; baseRevision: string; state: RunState;
  pane: string | null; tab: string | null; invocation: string | null; sessionFile: string | null;
  createdAt: string; updatedAt: string; detail: string;
}
export type RunPatch = Partial<Pick<TaskRun, 'pane' | 'tab' | 'invocation' | 'sessionFile' | 'detail'>>;
export interface RunStore {
  transaction<T>(fn: () => T): T;
  insert(run: TaskRun): void;
  get(id: string): TaskRun;
  list(requestId: number): TaskRun[];
  update(id: string, state: RunState, at: string, patch: RunPatch): TaskRun;
}
