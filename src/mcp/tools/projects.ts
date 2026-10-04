import { z } from 'zod';
import { text, externalPath } from '../schemas.js';
export const projects = {
  project_list: { schema: z.strictObject({ org: text.optional() }), description: 'List registered projects, optionally by organization.' },
  project_add: { schema: z.strictObject({ identity: text, code: text, checkoutPath: externalPath.optional() }), description: 'Register org/project in DB. Does not clone or create context.' },
  project_resolve: { schema: z.strictObject({ path: externalPath }), description: 'Resolve an existing directory to the deepest registered checkout. Returns project, none or ambiguous; never registers it.' },
};
