export { ACTIONS, isAction } from './model.js';
export type {
  Action, Profile, AuthorizationScope, NormalizedPolicy, PolicyPermissions, CallerIdentity,
  RepositoryBinding, PolicySnapshot, Capability, TrustedCallerContext, DataOwner,
  AuthorizationResource, AuthorizationDecision, DecisionReason,
} from './model.js';
export { DEFAULT_ALLOW, normalizePolicy, policyPermissions, resourcePermissions } from './policy.js';
export { createPolicySnapshot, attenuatePolicySnapshot, scopeContainsProject } from './snapshot.js';
export type { SnapshotInput, ResumeResult } from './snapshot.js';
export { decideAuthorization } from './decision.js';
