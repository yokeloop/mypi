import { isAbsolute, relative, sep } from 'node:path';
import { canonicalNativeToolPath, resolveNativeToolPath } from '../infrastructure/filesystem/native-tool-path.js';
import { decideWorktreeWrite } from '../modules/work-context/public.js';
import type { GuardPolicy, WorktreeWriteCondition } from '../modules/work-context/public.js';
import type { PiContextSelection } from './pi-context.js';

export interface WriteWorkspaceObservation {
  readonly selectedRoot: string;
  readonly baseRoot: string;
  readonly selectedIsBase: boolean;
}
export type NativeGuardPolicy = { readonly policy: GuardPolicy } | { readonly error: string };
export type NativeWriteGuardResult = { readonly block: true; readonly reason: string } | undefined;

function contains(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep));
}

export function worktreeWriteCondition(workspace: WriteWorkspaceObservation, target: string): WorktreeWriteCondition {
  if (workspace.selectedIsBase) return 'base';
  if (contains(workspace.selectedRoot, target)) return 'own-task';
  return contains(workspace.baseRoot, target) ? 'base' : 'outside';
}

/** SDK-free hook boundary. Observation is injected so fast consumers never import Git effects. */
export function guardNativeWrite(input: {
  readonly toolName: string;
  readonly path: unknown;
  readonly cwd: string;
  readonly home: string;
  readonly selection: PiContextSelection;
  readonly configuration: NativeGuardPolicy;
  readonly observe: (root: string) => WriteWorkspaceObservation;
  readonly warn: (message: string) => void;
}): NativeWriteGuardResult {
  if (input.toolName !== 'write' && input.toolName !== 'edit') return;
  if ('error' in input.configuration) return { block: true, reason: input.configuration.error };
  const selection = input.selection;
  if (selection.state !== 'selected' || selection.data.context.scope.kind === 'unrestricted') return;
  const root = selection.data.context.worktreeRoot;
  let condition: WorktreeWriteCondition = 'unusable';
  try {
    if (root && typeof input.path === 'string') {
      const workspace = input.observe(root);
      const target = canonicalNativeToolPath(resolveNativeToolPath(input.path, input.cwd, input.home));
      condition = worktreeWriteCondition(workspace, target);
    }
  } catch { /* An unavailable observation is a scoped guard condition, not permission. */ }
  const decision = decideWorktreeWrite(input.configuration.policy, condition);
  if (decision.behavior === 'block') return { block: true, reason: decision.message };
  if (decision.behavior === 'warn') input.warn(decision.message);
}
