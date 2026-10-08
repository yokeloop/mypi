import { InputError } from '../../shared/errors.js';
import { immutable, intersect, sameIdentity, validOrganization, validProject } from './model.js';
import type { AuthorizationScope, CallerIdentity, NormalizedPolicy, PolicyPermissions, PolicySnapshot, Profile, RepositoryBinding } from './model.js';
import { normalizePolicy, policyPermissions } from './policy.js';

export interface SnapshotInput {
  readonly revision: string;
  readonly identity: CallerIdentity;
  readonly scope: AuthorizationScope;
  readonly profile?: Profile;
  readonly policy: NormalizedPolicy;
  readonly bindings: readonly RepositoryBinding[];
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.includes('\0');
function scopeSnapshot(scope: AuthorizationScope): AuthorizationScope {
  if (scope.kind === 'unrestricted') return { kind: 'unrestricted' };
  if (scope.kind === 'project' && validProject(scope.project)) return { kind: 'project', project: scope.project };
  if (scope.kind === 'organization' && validOrganization(scope.organization) && Array.isArray(scope.projects)
    && scope.projects.every(project => validProject(project) && project.split('/')[0] === scope.organization)) {
    return { kind: 'organization', organization: scope.organization, projects: [...new Set(scope.projects)].sort() };
  }
  throw new InputError('Invalid authorization scope');
}
function validateIdentity(identity: CallerIdentity): void {
  if (!identity.principal || !['operator', 'agent', 'service'].includes(identity.principal.kind)
    || !nonempty(identity.principal.id)
    || (identity.sessionId !== null && !nonempty(identity.sessionId))
    || (identity.runtimeId !== null && !nonempty(identity.runtimeId))
    || (identity.principal.kind === 'agent' && identity.sessionId === null)
    || (identity.runtimeId !== null && identity.sessionId === null)) throw new InputError('Invalid caller identity');
}
function bindingSnapshot(bindings: readonly RepositoryBinding[]): readonly RepositoryBinding[] {
  if (!Array.isArray(bindings) || new Set(bindings.map(binding => binding.id)).size !== bindings.length) {
    throw new InputError('Invalid repository bindings');
  }
  return bindings.map(binding => {
    if (!nonempty(binding.id) || !validProject(binding.project) || !nonempty(binding.branch)
      || ![binding.baseRoot, binding.commonDir, binding.worktreeRoot].every(path => nonempty(path) && path.startsWith('/'))) {
      throw new InputError('Invalid repository binding');
    }
    return { id: binding.id, project: binding.project, baseRoot: binding.baseRoot,
      commonDir: binding.commonDir, worktreeRoot: binding.worktreeRoot, branch: binding.branch };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/** Revision is computed by trusted composition from canonical inputs; this module performs no hashing or verification IO. */
export function createPolicySnapshot(input: SnapshotInput): PolicySnapshot {
  if (!nonempty(input.revision)) throw new InputError('Policy revision required');
  validateIdentity(input.identity);
  const scope = scopeSnapshot(input.scope), profile = input.profile ?? 'standard';
  if (!['standard', 'isolated'].includes(profile)) throw new InputError('Invalid execution profile');
  if (scope.kind !== 'unrestricted' && profile !== 'isolated') throw new InputError('Scoped authorization requires isolated profile');
  return immutable({ revision: input.revision, identity: input.identity, profile, scope,
    permissions: policyPermissions(normalizePolicy(input.policy), profile), bindings: bindingSnapshot(input.bindings) });
}
export function scopeContainsProject(scope: AuthorizationScope, project: string): boolean {
  if (!validProject(project)) return false;
  switch (scope.kind) {
    case 'unrestricted': return true;
    case 'project': return scope.project === project;
    case 'organization': return scope.projects.includes(project) && project.split('/')[0] === scope.organization;
    default: return false;
  }
}
function intersectScope(saved: AuthorizationScope, current: AuthorizationScope): AuthorizationScope | null {
  if (saved.kind === 'unrestricted') return current;
  if (current.kind === 'unrestricted') return saved;
  if (saved.kind === 'project') return scopeContainsProject(current, saved.project) ? saved : null;
  if (current.kind === 'project') return scopeContainsProject(saved, current.project) ? current : null;
  if (saved.organization !== current.organization) return null;
  return { kind: 'organization', organization: saved.organization, projects: saved.projects.filter(project => current.projects.includes(project)) };
}
function attenuatePermissions(saved: PolicyPermissions, current: PolicyPermissions): PolicyPermissions {
  function rules(kind: 'organizations' | 'projects') {
    return Object.fromEntries([...new Set([...Object.keys(saved[kind]), ...Object.keys(current[kind])])].sort().map(key => [key,
      intersect(Object.hasOwn(saved[kind], key) ? saved[kind][key]! : saved.allow,
        Object.hasOwn(current[kind], key) ? current[kind][key]! : current.allow)]));
  }
  return { allow: intersect(saved.allow, current.allow), organizations: rules('organizations'), projects: rules('projects') };
}
export type ResumeResult = { readonly status: 'resumed'; readonly snapshot: PolicySnapshot; readonly ownedBindingIds: readonly [] }
  | { readonly status: 'reconciliation-required'; readonly reason: 'identity-changed' | 'binding-changed' | 'scope-changed' };

/** Saved snapshots contain no leases/capabilities. Ownership must be reacquired out of band after resume. */
export function attenuatePolicySnapshot(saved: PolicySnapshot, current: PolicySnapshot, revision: string): ResumeResult {
  if (!nonempty(revision)) throw new InputError('Policy revision required');
  if (!sameIdentity(saved.identity, current.identity)) return { status: 'reconciliation-required', reason: 'identity-changed' };
  const bindings = saved.bindings.map(binding => current.bindings.find(candidate => candidate.id === binding.id));
  if (bindings.some((binding, index) => !binding || JSON.stringify(binding) !== JSON.stringify(saved.bindings[index]))) {
    return { status: 'reconciliation-required', reason: 'binding-changed' };
  }
  const scope = intersectScope(saved.scope, current.scope);
  if (!scope) return { status: 'reconciliation-required', reason: 'scope-changed' };
  return immutable({ status: 'resumed', ownedBindingIds: [], snapshot: {
    revision, identity: current.identity, scope,
    profile: saved.profile === 'isolated' || current.profile === 'isolated' ? 'isolated' : 'standard',
    permissions: attenuatePermissions(saved.permissions, current.permissions), bindings: saved.bindings,
  } });
}
