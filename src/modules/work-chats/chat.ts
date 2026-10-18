import { InputError } from '../../shared/errors.js';

export interface ChatBinding {
  requestId: number;
  projectId: number;
  sourceClone: string;
  worktree: string;
  gitCommonDir: string;
  branch: string;
  installation: string;
  statePath: string;
}
export interface ProcessIdentity { pane: string; processId: number; processStart: string }
export interface NativeIdentity { sessionId: string; historyPath: string }
export interface WorkChat extends ChatBinding {
  id: string;
  name: string | null;
  attemptId: string;
  phase: 'reserved' | 'partial' | 'ready' | 'closed';
  sessionId: string | null;
  historyPath: string | null;
  pane: string | null;
  processId: number | null;
  processStart: string | null;
}
export interface ChatStore {
  list(): WorkChat[];
  get(id: string): WorkChat | undefined;
  byWorktree(worktree: string): WorkChat | undefined;
  reserve(chat: WorkChat): void;
  update(chat: WorkChat, previousAttempt?: string): void;
  releaseUnused(id: string, attemptId: string): void;
  transaction<T>(work: () => T): T;
}
export function assertBinding(expected: ChatBinding, actual: ChatBinding): void {
  for (const field of ['requestId', 'projectId', 'sourceClone', 'worktree', 'gitCommonDir', 'branch', 'installation', 'statePath'] as const) {
    if (expected[field] !== actual[field]) throw new InputError(`Work chat ${field} changed; reconcile setup before opening`);
  }
}
export function assertNative(expected: NativeIdentity, actual: NativeIdentity): void {
  if (expected.sessionId !== actual.sessionId || expected.historyPath !== actual.historyPath) {
    throw new InputError('Native session identity changed; managed history cannot be adopted');
  }
}
