export const ACTIONS = Object.freeze([
  'data.read', 'data.write', 'filesystem.read', 'filesystem.write', 'execution.run',
  'workspace.inspect', 'workspace.prepare', 'workspace.commit', 'workspace.publish',
  'workspace.remove', 'runtime.control', 'administration', 'policy.validate', 'policy.explain',
] as const);
export type Action = typeof ACTIONS[number];
export type Profile = 'standard' | 'isolated';
export type AuthorizationScope =
  | { readonly kind: 'project'; readonly project: string }
  | { readonly kind: 'organization'; readonly organization: string; readonly projects: readonly string[] }
  | { readonly kind: 'unrestricted' };

export interface PolicyPermissions {
  readonly allow: readonly Action[];
  readonly organizations: Readonly<Record<string, readonly Action[]>>;
  readonly projects: Readonly<Record<string, readonly Action[]>>;
}
export interface NormalizedPolicy {
  readonly version: 1;
  readonly defaults: { readonly allow: readonly Action[] };
  readonly profiles: {
    readonly standard: { readonly allow: readonly Action[]; readonly isolation: 'none' };
    readonly isolated: { readonly allow: readonly Action[]; readonly isolation: 'required' };
  };
  readonly overrides: {
    readonly organizations: Readonly<Record<string, { readonly allow: readonly Action[] }>>;
    readonly projects: Readonly<Record<string, { readonly allow: readonly Action[] }>>;
  };
  readonly repositories: Readonly<Record<string, { readonly root: string }>>;
}
export interface CallerIdentity {
  readonly principal: { readonly kind: 'operator' | 'agent' | 'service'; readonly id: string };
  readonly sessionId: string | null;
  readonly runtimeId: string | null;
}
// Evidence supplied by trusted repository verification, not by policy root strings or tool arguments.
export interface RepositoryBinding {
  readonly id: string;
  readonly project: string;
  readonly baseRoot: string;
  readonly commonDir: string;
  readonly worktreeRoot: string;
  readonly branch: string;
}
export interface PolicySnapshot {
  readonly revision: string;
  readonly identity: CallerIdentity;
  readonly profile: Profile;
  readonly scope: AuthorizationScope;
  readonly permissions: PolicyPermissions;
  readonly bindings: readonly RepositoryBinding[];
}
export type Capability = 'administration' | 'runtime.control' | 'HomeWriter'
  | 'workspace.prepare' | 'workspace.publish';
// These are trusted in-process assertions, NOT authentication or serializable bearer credentials.
export interface TrustedCallerContext extends CallerIdentity {
  readonly profile: Profile;
  readonly snapshot: PolicySnapshot;
  readonly capabilities: readonly Capability[];
  readonly ownedBindingIds: readonly string[];
}
export type DataOwner = { readonly kind: 'project'; readonly project: string }
  | { readonly kind: 'organization'; readonly organization: string }
  | { readonly kind: 'global' } | { readonly kind: 'all' };
export type AuthorizationResource =
  | { readonly kind: 'data'; readonly owner: DataOwner; readonly record: 'memory' | 'request' | 'other' }
  | { readonly kind: 'inherited-memory'; readonly owner: DataOwner; readonly consumerProject: string }
  | { readonly kind: 'repository'; readonly bindingId: string }
  | { readonly kind: 'scratch'; readonly sessionId: string }
  | { readonly kind: 'shared-git' }
  | { readonly kind: 'policy' }
  | { readonly kind: 'control-plane' }
  | { readonly kind: 'administrative' }
  | { readonly kind: 'runtime'; readonly runtimeId: string };
export type DecisionReason = 'allowed' | 'invalid-input' | 'identity-mismatch' | 'isolation-required'
  | 'scope-denied' | 'rule-denied' | 'protected-resource' | 'binding-required'
  | 'base-read-only' | 'ownership-required' | 'capability-required';
export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly revision: string;
  readonly reason: DecisionReason;
  readonly rule: DecisionReason;
}

export function immutable<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(item => immutable(item))) as T;
  if (value !== null && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutable(item)]))) as T;
  }
  return value;
}
export const validOrganization = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value);
export const validProject = (value: unknown): value is string =>
  typeof value === 'string' && value.split('/').length === 2 && value.split('/').every(validOrganization);
export const isAction = (value: unknown): value is Action =>
  typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
export const intersect = (a: readonly Action[], b: readonly Action[]): readonly Action[] =>
  ACTIONS.filter(action => a.includes(action) && b.includes(action));
export const sameIdentity = (a: CallerIdentity, b: CallerIdentity): boolean =>
  !!a?.principal && !!b?.principal && typeof a.principal.id === 'string' && a.principal.id.length > 0
  && a.sessionId !== undefined && a.runtimeId !== undefined
  && a.principal.kind === b.principal.kind && a.principal.id === b.principal.id
  && a.sessionId === b.sessionId && a.runtimeId === b.runtimeId;
