import { isAction, sameIdentity, validOrganization, validProject } from './model.js';
import type { Action, AuthorizationDecision, AuthorizationResource, DataOwner, DecisionReason, RepositoryBinding, TrustedCallerContext } from './model.js';
import { resourcePermissions } from './policy.js';
import { scopeContainsProject } from './snapshot.js';

function validOwner(owner: DataOwner): boolean {
  switch (owner?.kind) {
    case 'project': return validProject(owner.project);
    case 'organization': return validOrganization(owner.organization);
    case 'global': case 'all': return true;
    default: return false;
  }
}
function ownerAllowed(caller: TrustedCallerContext, owner: DataOwner): boolean {
  const scope = caller.snapshot.scope;
  if (scope.kind === 'unrestricted') return true;
  if (owner.kind === 'project') return scopeContainsProject(scope, owner.project);
  return owner.kind === 'organization' && scope.kind === 'organization' && owner.organization === scope.organization;
}

/** Pure explanation only. Effect boundaries must resolve resources and authenticate the caller before using this API. */
export function decideAuthorization(caller: TrustedCallerContext, action: Action, resource: AuthorizationResource): AuthorizationDecision {
  const snapshot = caller.snapshot;
  const result = (reason: DecisionReason): AuthorizationDecision => Object.freeze({
    allowed: reason === 'allowed', revision: snapshot.revision, reason, rule: reason,
  });
  if (!isAction(action) || !resource || typeof resource !== 'object') return result('invalid-input');
  if (!sameIdentity(caller, snapshot.identity) || caller.profile !== snapshot.profile) return result('identity-mismatch');
  if (snapshot.scope.kind !== 'unrestricted' && snapshot.profile !== 'isolated') return result('isolation-required');
  let organization: string | undefined, project: string | undefined, binding: RepositoryBinding | undefined;
  switch (resource.kind) {
    case 'data': {
      if (!['data.read', 'data.write'].includes(action) || !validOwner(resource.owner)
        || !['memory', 'request', 'other'].includes(resource.record)
        || (resource.record === 'request' && resource.owner.kind === 'organization')
        || (action === 'data.write' && resource.owner.kind === 'all')) return result('invalid-input');
      if (!ownerAllowed(caller, resource.owner)) return result('scope-denied');
      if (resource.owner.kind === 'project') project = resource.owner.project;
      if (resource.owner.kind === 'organization') organization = resource.owner.organization;
      break;
    }
    case 'inherited-memory': {
      if (action !== 'data.read' || !validProject(resource.consumerProject) || !validOwner(resource.owner)
        || !(resource.owner.kind === 'global' || (resource.owner.kind === 'organization'
          && resource.owner.organization === resource.consumerProject.split('/')[0]))) return result('invalid-input');
      if (!scopeContainsProject(snapshot.scope, resource.consumerProject)) return result('scope-denied');
      project = resource.consumerProject;
      break;
    }
    case 'repository': {
      if (!['filesystem.read', 'filesystem.write', 'execution.run', 'workspace.inspect', 'workspace.prepare',
        'workspace.commit', 'workspace.publish', 'workspace.remove'].includes(action)) return result('invalid-input');
      binding = snapshot.bindings.find(candidate => candidate.id === resource.bindingId);
      if (!binding) return result('binding-required');
      if (!scopeContainsProject(snapshot.scope, binding.project)) return result('scope-denied');
      project = binding.project;
      break;
    }
    case 'scratch':
      if (!['filesystem.read', 'filesystem.write', 'execution.run'].includes(action)) return result('invalid-input');
      if (!caller.sessionId || caller.sessionId !== resource.sessionId) return result('ownership-required');
      break;
    case 'policy':
      if (!['policy.validate', 'policy.explain'].includes(action)) return result('protected-resource');
      break;
    case 'shared-git': case 'control-plane': return result('protected-resource');
    case 'administrative':
      if (action !== 'administration') return result('invalid-input');
      if (snapshot.scope.kind !== 'unrestricted') return result('scope-denied');
      break;
    case 'runtime':
      if (action !== 'runtime.control') return result('invalid-input');
      if (!caller.runtimeId || caller.runtimeId !== resource.runtimeId) return result('ownership-required');
      break;
    default: return result('invalid-input');
  }
  if (project) organization = project.split('/')[0];
  if (!resourcePermissions(snapshot.permissions, organization, project).includes(action)) return result('rule-denied');
  if (binding && action === 'workspace.prepare') {
    // The binding is the verified SOURCE, not an existing write target. A trusted broker may
    // create a NEW workspace with this capability; it must acquire target ownership separately.
    if (!caller.sessionId || !caller.runtimeId) return result('ownership-required');
  } else if (binding && !['filesystem.read', 'workspace.inspect'].includes(action)) {
    if (binding.worktreeRoot === binding.baseRoot) return result('base-read-only');
    if (!caller.sessionId || !caller.ownedBindingIds.includes(binding.id)) return result('ownership-required');
  }
  const capability = action === 'data.write' ? 'HomeWriter'
    : action === 'administration' || action === 'runtime.control' || action === 'workspace.prepare' || action === 'workspace.publish' ? action : null;
  if (capability && !caller.capabilities.includes(capability)) return result('capability-required');
  return result('allowed');
}
