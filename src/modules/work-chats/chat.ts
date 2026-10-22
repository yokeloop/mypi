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
export interface ProcessIdentity {
  pane: string;
  processId: number;
  processStart: string;
  processBootId?: string;
  /** Normalized absolute local socket path, not proof of a unique server instance. */
  herdrEndpoint?: string;
}
export interface NativeIdentity { sessionId: string; historyPath: string }
export interface WorkChat extends ChatBinding {
  id: string;
  name: string | null;
  attemptId: string;
  requestedProvider: string | null;
  requestedModel: string | null;
  /** Last launch fact only. Legacy ready/auth-pending do not imply current liveness/auth. */
  phase: 'reserved' | 'partial' | 'auth-pending' | 'ready' | 'closed';
  sessionId: string | null;
  historyPath: string | null;
  pane: string | null;
  processId: number | null;
  processStart: string | null;
  processBootId?: string | null;
  herdrEndpoint?: string | null;
}
export interface ChatStore {
  list(): WorkChat[];
  get(id: string): WorkChat | undefined;
  byWorktree(worktree: string): WorkChat | undefined;
  reserve(chat: WorkChat): void;
  update(chat: WorkChat, previousAttempt?: string): void;
  retireEmpty(id: string, attemptId: string): void;
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
