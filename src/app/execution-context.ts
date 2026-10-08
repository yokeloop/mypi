import type { AuthorizationResource, TrustedCallerContext } from '../modules/authorization/public.js';

/** Untrusted selectors, never resolved ownership or repository evidence. */
export type PolicyTarget =
  | { readonly kind: 'project'; readonly project: string }
  | { readonly kind: 'organization'; readonly organization: string }
  | { readonly kind: 'request'; readonly key: string }
  | { readonly kind: 'repository'; readonly bindingId: string }
  | { readonly kind: 'global' }
  | { readonly kind: 'all' }
  | { readonly kind: 'policy' | 'scratch' | 'runtime' | 'shared-git' | 'control-plane' | 'administrative' };
export type DataPolicyTarget = Extract<PolicyTarget, { kind: 'project' | 'organization' | 'request' }>
  | { readonly kind: 'global' | 'all' };

/**
 * Trusted composition only; no CLI/MCP field can construct this context.
 * The resolver must look up registry/request ownership, not trust selector claims.
 * It must return only authorized-view data evidence (including inherited memory
 * when appropriate), never perform mutations or return foreign details in errors.
 * Snapshot/bindings and caller capabilities are authenticated by the future runtime.
 */
export interface TrustedExecutionContext {
  readonly caller: TrustedCallerContext;
  readonly resolveDataTarget: (target: DataPolicyTarget) => AuthorizationResource | undefined;
}
