import { z } from 'zod';
import { POLICY_GUARDS } from '../../app/policy-commands.js';

// The shared parser enforces UTF-8 byte/AST budgets; MCP never reads a policy path.
const text = z.string().max(65536);
export const policy = {
  policy_validate: { schema: z.strictObject({ text }),
    description: 'Validate YAML v2 and return normalized guard settings. Cooperative diagnostic only; no installation or interception.' },
  policy_explain: { schema: z.strictObject({ guard: z.enum(POLICY_GUARDS), text: text.optional() }),
    description: 'Explain a configured warn/block guard response. Omitted text uses defaults; invalid text fails. Cooperative diagnostic, not an intercepted operation.' },
};
