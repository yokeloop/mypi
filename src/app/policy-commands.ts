import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { MAX_POLICY_BYTES } from '../infrastructure/configuration/policy-yaml.js';
import { ACTIONS, decideAuthorization, isAction, scopeContainsProject } from '../modules/authorization/public.js';
import type { Action, AuthorizationDecision, AuthorizationResource, AuthorizationScope, Profile, TrustedCallerContext } from '../modules/authorization/public.js';
import { createRevisionedPolicySnapshot, validatePolicyText } from './policy-config.js';
import type { PolicyTarget, TrustedExecutionContext } from './execution-context.js';
import { InputError } from '../shared/errors.js';

export { ACTIONS as POLICY_ACTIONS };

/** Explicit CLI text input, NOT an authoritative trusted policy source. */
export function readPolicyInputFile(path: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_POLICY_BYTES) throw new InputError('Policy input must be a regular file of at most 65536 bytes');
    const buffer = Buffer.alloc(MAX_POLICY_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const size = readSync(fd, buffer, length, buffer.length - length, null);
      if (!size) break;
      length += size;
    }
    if (length > MAX_POLICY_BYTES) throw new InputError('Policy input exceeds 65536 bytes');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('Policy input unavailable or invalid UTF-8');
  } finally { if (fd !== undefined) closeSync(fd); }
}
export type { PolicyTarget } from './execution-context.js';
export type PolicyCommand =
  | { name: 'policy_validate'; text: string }
  | { name: 'policy_explain'; action: Action; target: PolicyTarget }
  | { name: 'policy_preview'; text: string; action: Action; target: PolicyTarget; scope: AuthorizationScope; profile?: Profile };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Expected diagnostic object');
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, names: string[]): void {
  if (Object.keys(value).some(key => !names.includes(key))) throw new InputError('Unknown diagnostic field');
}
function selector(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\0')) throw new InputError('Invalid target selector');
  return value;
}
export function policyAction(value: unknown): Action {
  if (!isAction(value)) throw new InputError('Unknown policy action');
  return value;
}
export function policyTarget(value: unknown): PolicyTarget {
  const v = object(value);
  switch (v['kind']) {
    case 'project': fields(v, ['kind', 'project']); return { kind: 'project', project: selector(v['project']) };
    case 'organization': fields(v, ['kind', 'organization']); return { kind: 'organization', organization: selector(v['organization']) };
    case 'request': fields(v, ['kind', 'key']); return { kind: 'request', key: selector(v['key']) };
    case 'repository': fields(v, ['kind', 'bindingId']); return { kind: 'repository', bindingId: selector(v['bindingId']) };
    case 'global': case 'all': case 'policy': case 'scratch': case 'runtime': case 'shared-git': case 'control-plane': case 'administrative':
      fields(v, ['kind']); return { kind: v['kind'] };
    default: throw new InputError('Unknown policy target');
  }
}
export function policyPreviewScope(value: unknown): AuthorizationScope {
  const v = object(value);
  switch (v['kind']) {
    case 'unrestricted': fields(v, ['kind']); return { kind: 'unrestricted' };
    case 'project': fields(v, ['kind', 'project']); return { kind: 'project', project: selector(v['project']) };
    case 'organization':
      fields(v, ['kind', 'organization', 'projects']);
      if (!Array.isArray(v['projects']) || v['projects'].length > 1024) throw new InputError('Explicit preview membership required');
      return { kind: 'organization', organization: selector(v['organization']), projects: v['projects'].map(selector) };
    default: throw new InputError('Unknown preview scope');
  }
}
export function policyPreviewProfile(value: unknown): Profile {
  if (value !== 'standard' && value !== 'isolated') throw new InputError('Unknown preview profile');
  return value;
}

type DiagnosticDecision = AuthorizationDecision | {
  readonly allowed: false; readonly revision: string | null;
  readonly reason: 'context-unavailable' | 'target-unavailable'; readonly rule: 'context-unavailable' | 'target-unavailable';
};
function denied(reason: 'context-unavailable' | 'target-unavailable', revision: string | null): DiagnosticDecision {
  return { allowed: false, revision, reason, rule: reason };
}
function visible(caller: TrustedCallerContext, resource: AuthorizationResource): boolean {
  const scope = caller.snapshot.scope;
  if (resource.kind === 'repository') {
    const binding = caller.snapshot.bindings.find(b => b.id === resource.bindingId);
    return !!binding && scopeContainsProject(scope, binding.project);
  }
  if (resource.kind === 'inherited-memory') return scopeContainsProject(scope, resource.consumerProject);
  if (resource.kind !== 'data' || scope.kind === 'unrestricted') return true;
  const owner = resource.owner;
  return owner.kind === 'project' ? scopeContainsProject(scope, owner.project)
    : owner.kind === 'organization' && scope.kind === 'organization' && owner.organization === scope.organization;
}
function resolveTarget(target: PolicyTarget, context: TrustedExecutionContext): AuthorizationResource | undefined {
  const caller = context.caller;
  switch (target.kind) {
    case 'project': case 'organization': case 'request': case 'global': case 'all': {
      const resource = context.resolveDataTarget(target);
      // A data selector cannot be promoted to control-plane or repository authority.
      return resource?.kind === 'data' || resource?.kind === 'inherited-memory' ? resource : undefined;
    }
    case 'repository': return caller.snapshot.bindings.some(b => b.id === target.bindingId)
      ? { kind: 'repository', bindingId: target.bindingId } : undefined;
    case 'scratch': return caller.sessionId ? { kind: 'scratch', sessionId: caller.sessionId } : undefined;
    case 'runtime': return caller.runtimeId ? { kind: 'runtime', runtimeId: caller.runtimeId } : undefined;
    default: return { kind: target.kind };
  }
}
function effectiveDecision(action: Action, target: PolicyTarget, context: TrustedExecutionContext | undefined): DiagnosticDecision {
  if (!context) return denied('context-unavailable', null);
  let resource: AuthorizationResource | undefined;
  try { resource = resolveTarget(target, context); }
  catch { return denied('target-unavailable', context.caller.snapshot.revision); }
  if (!resource || !visible(context.caller, resource)) return denied('target-unavailable', context.caller.snapshot.revision);
  return decideAuthorization(context.caller, action, resource);
}

/** Diagnostics do not install policy, reload a live source, or authorize any actual effect. */
export function executePolicyCommand(command: PolicyCommand, context?: TrustedExecutionContext): unknown {
  if (command.name === 'policy_validate') {
    const configuration = validatePolicyText(command.text);
    return { valid: true, revision: configuration.revision, revisionKind: 'configuration', enforced: false };
  }
  const action = policyAction(command.action), target = policyTarget(command.target);
  if (command.name === 'policy_explain') return { ...effectiveDecision(action, target, context), preview: false, enforced: false };
  const configuration = validatePolicyText(command.text);
  const scope = policyPreviewScope(command.scope);
  const snapshot = createRevisionedPolicySnapshot({ policy: configuration.policy, scope,
    ...(command.profile === undefined ? {} : { profile: policyPreviewProfile(command.profile) }),
    identity: { principal: { kind: 'service', id: 'policy-preview' }, sessionId: null, runtimeId: null }, bindings: [] });
  const caller: TrustedCallerContext = { ...snapshot.identity, profile: snapshot.profile, snapshot, capabilities: [], ownedBindingIds: [] };
  // Hypothetical data only: no registry lookup, verified repositories, runtime ownership or capabilities.
  const preview: TrustedExecutionContext = { caller, resolveDataTarget: selector => {
    switch (selector.kind) {
      case 'project': return { kind: 'data', owner: { kind: 'project', project: selector.project }, record: 'other' };
      case 'organization': return { kind: 'data', owner: { kind: 'organization', organization: selector.organization }, record: 'other' };
      case 'global': case 'all': return { kind: 'data', owner: { kind: selector.kind }, record: 'other' };
      default: return undefined;
    }
  } };
  return { ...effectiveDecision(action, target, preview), preview: true, enforced: false };
}
