import type { GuardName, GuardPolicy } from './guard-policy.js';

export type GuardDecision = { readonly behavior: 'allow' }
  | { readonly behavior: 'warn' | 'block'; readonly guard: GuardName; readonly message: string };

/** A cooperative diagnostic, not an authorization or filesystem permission. */
export function guardResponse(policy: GuardPolicy, guard: GuardName, message: string): GuardDecision {
  return { behavior: policy.guards[guard], guard, message };
}

export type WorktreeWriteCondition = 'own-task' | 'base' | 'outside' | 'unusable';
export function decideWorktreeWrite(policy: GuardPolicy, condition: WorktreeWriteCondition): GuardDecision {
  switch (condition) {
    case 'own-task': return { behavior: 'allow' };
    case 'base': return guardResponse(policy, 'baseCheckoutWrite', 'mypi: base checkout write. Select a task worktree before changes.');
    case 'outside': return guardResponse(policy, 'outsideWorktreeWrite', 'mypi: write outside the selected task worktree. Check the path or select the intended worktree.');
    case 'unusable': return guardResponse(policy, 'outsideWorktreeWrite', 'mypi: scoped write needs a usable selected task worktree. Select a concrete project/worktree before changes.');
  }
}
