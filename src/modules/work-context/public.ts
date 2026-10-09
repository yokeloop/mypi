export type { GuardDecision, WorktreeWriteCondition } from './guard-decision.js';
export { guardResponse, decideWorktreeWrite } from './guard-decision.js';
export type { WorkScope, WorkContext } from './context.js';
export { scopeContainsProject } from './context.js';
export type { GuardName, GuardBehavior, GuardPolicy, GuardExplanation } from './guard-policy.js';
export { DEFAULT_GUARD_POLICY, normalizeGuardPolicy, explainGuard } from './guard-policy.js';
