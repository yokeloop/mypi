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
    resolveCheckout(input: string) {
      const path = paths.canonicalDirectory(input);
      const candidates = store.list().filter(p => p.checkoutPath !== null
        && (path === p.checkoutPath || path.startsWith(p.checkoutPath.replace(/\/$/, '') + '/')));
      const depth = Math.max(0, ...candidates.map(p => p.checkoutPath!.length));
      const matches = candidates.filter(p => p.checkoutPath!.length === depth);
      if (matches.length === 0) return { match: 'none' as const };
      if (matches.length > 1) return { match: 'ambiguous' as const, projects: matches };
      const project = matches[0]!;
      return { match: 'project' as const, identity: project.org + '/' + project.slug,
        code: project.code, scope: { type: 'project' as const, key: project.code } };
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
