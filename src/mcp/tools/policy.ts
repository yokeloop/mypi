import { z } from 'zod';
import { POLICY_ACTIONS } from '../../app/policy-commands.js';

const selector = z.string().min(1).max(1024).refine(value => !value.includes('\0'), 'NUL forbidden');
const target = z.union([
  z.strictObject({ kind: z.literal('project'), project: selector }),
  z.strictObject({ kind: z.literal('organization'), organization: selector }),
  z.strictObject({ kind: z.literal('request'), key: selector }),
  z.strictObject({ kind: z.literal('repository'), bindingId: selector }),
  z.strictObject({ kind: z.enum(['global', 'all', 'policy', 'scratch', 'runtime', 'shared-git', 'control-plane', 'administrative']) }),
]);
const scope = z.union([
  z.strictObject({ kind: z.literal('unrestricted') }),
  z.strictObject({ kind: z.literal('project'), project: selector }),
  z.strictObject({ kind: z.literal('organization'), organization: selector, projects: z.array(selector).max(1024) }),
]);
const action = z.enum(POLICY_ACTIONS);
// The shared parser enforces the UTF-8 byte/AST budgets; MCP never reads a policy path.
const text = z.string().max(65536);
export const policy = {
  policy_validate: { schema: z.strictObject({ text }), description: 'Validate supplied YAML text and return configuration revision. No installation, activation or grant.' },
  policy_explain: { schema: z.strictObject({ action, target }), description: 'Explain against trusted live caller/snapshot; missing context or unresolved/foreign target denies. Selectors are untrusted. Diagnostic only, not enforcement.' },
  policy_preview: { schema: z.strictObject({ text, action, target, scope, profile: z.enum(['standard', 'isolated']).optional() }),
    description: 'Explicit hypothetical preview with a fixed non-admin caller, no ownership/capabilities. Returns preview:true and evaluated revision, never a live grant. Scoped preview requires isolated profile.' },
};
