import { InputError } from '../../shared/errors.js';
import { parseIdentity, validSlug, validateCode } from './model.js';
import type { ProjectScope } from './model.js';
import type { CheckoutPaths, ProjectStore } from './ports.js';

export type { Project, ProjectScope } from './model.js';

export function createProjects(store: ProjectStore, paths: CheckoutPaths) {
  return {
    add(identity: string, code: string, checkoutPath?: string) {
      const { org, slug } = parseIdentity(identity);
      validateCode(code);
      const canonical = checkoutPath === undefined ? null : paths.canonicalDirectory(checkoutPath);
      return store.add({ org, slug, code, checkoutPath: canonical });
    },
    list(org?: string) {
      if (org !== undefined && (!validSlug(org) || !store.findOrganization(org))) {
        throw new InputError('Unknown organization');
      }
      return store.list(org);
    },
    resolveScope(value?: string): ProjectScope {
      if (value === undefined) return { type: 'global' };
      if (!value.includes('/')) {
        if (!validSlug(value)) throw new InputError('Invalid organization slug');
        const org = store.findOrganization(value);
        if (!org) throw new InputError('Unknown organization');
        return { type: 'org', ...org };
      }
      const { org, slug } = parseIdentity(value);
      const project = store.find(org, slug);
      if (!project) throw new InputError('Unknown project');
      return { type: 'project', project };
    },
  };
}
