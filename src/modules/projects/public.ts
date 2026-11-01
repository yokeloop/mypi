import { InputError } from '../../shared/errors.js';
import { parseIdentity, validSlug, validateCode } from './model.js';
import { validateRepository } from './repository.js';
import type { ProjectScope } from './model.js';
import type { CheckoutPaths, ProjectStore } from './ports.js';

export type { Project, ProjectScope } from './model.js';
export { parseIdentity } from './model.js';
export { parseFlow, taskBranchName, validBranchName, DEFAULT_TASK_BRANCH } from './flow.js';
export type { ProjectFlow, MergeMethod } from './flow.js';
export { LOCAL_REPOSITORY, validateRepository, checkoutTarget, noRepositoryError, planCheckout } from './repository.js';
export type { CheckoutState } from './repository.js';

export function createProjects(store: ProjectStore, paths: CheckoutPaths) {
  function update(identity: string, change: { checkout?: { expected: string | null; path: string };
    repository?: { expected: string | null; value: string } }) {
    const { org, slug } = parseIdentity(identity);
    if (!change.checkout && !change.repository) throw new InputError('project update needs a checkout path or a repository');
    const checkout = change.checkout && { expected: change.checkout.expected, path: paths.canonicalAbsoluteDirectory(change.checkout.path) };
    if (change.repository) validateRepository(change.repository.value);
    return store.update({ org, slug, ...(checkout ? { checkout } : {}), ...(change.repository ? { repository: change.repository } : {}) });
  }
  return {
    add(identity: string, code: string, checkoutPath?: string, repository?: string) {
      const { org, slug } = parseIdentity(identity);
      validateCode(code);
      if (repository !== undefined) validateRepository(repository);
      const canonical = checkoutPath === undefined ? null : paths.canonicalDirectory(checkoutPath);
      return store.add({ org, slug, code, checkoutPath: canonical, repository: repository ?? null });
    },
    update,
    updateCheckout(identity: string, expectedCheckoutPath: string | null, checkoutPath: string) {
      return update(identity, { checkout: { expected: expectedCheckoutPath, path: checkoutPath } });
    },
    remove(identity: string, expectedCode: string) {
      const { org, slug } = parseIdentity(identity);
      return store.remove({ org, slug, expectedCode });
    },
    removeOrganization(org: string) {
      if (!validSlug(org)) throw new InputError('Invalid organization slug');
      store.removeOrganization(org);
      return org;
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
        code: project.code, scope: { type: 'project' as const, key: project.code }, repository: project.repository };
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
