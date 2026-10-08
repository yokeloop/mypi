import { InputError } from '../../shared/errors.js';
import { ACTIONS, immutable, intersect, isAction, validOrganization, validProject } from './model.js';
import type { Action, NormalizedPolicy, PolicyPermissions, Profile } from './model.js';

export const DEFAULT_ALLOW: readonly Action[] = Object.freeze([
  'data.read', 'filesystem.read', 'workspace.inspect', 'policy.validate', 'policy.explain',
]);

function fail(location: string, expected: string): never {
  // Locations are schema labels only: never echo arbitrary keys, values, paths or YAML text.
  throw new InputError(`Invalid policy ${location}: ${expected}`);
}
function mapping(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(location, 'expected mapping');
  return value as Record<string, unknown>;
}
function fields(value: unknown, allowed: readonly string[], location: string): Record<string, unknown> {
  const result = mapping(value, location);
  if (Object.keys(result).some(key => !allowed.includes(key))) fail(location, 'unknown field');
  return result;
}
function actions(value: unknown, location: string): readonly Action[] {
  if (!Array.isArray(value) || !value.every(isAction) || new Set(value).size !== value.length) {
    fail(location, 'expected unique supported actions');
  }
  return ACTIONS.filter(action => value.includes(action));
}
function overrides(value: unknown, project: boolean): Record<string, { allow: readonly Action[] }> {
  if (value === undefined) return {};
  return Object.fromEntries(Object.entries(mapping(value, 'overrides')).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => {
    if (!(project ? validProject(key) : validOrganization(key))) fail('overrides', 'invalid identity');
    const rule = fields(entry, ['allow'], 'override');
    return [key, { allow: actions(rule['allow'], 'override.allow') }];
  }));
}

/** Semantic validation of the complete v1 document; syntax adapters must delegate here. */
export function normalizePolicy(value: unknown): NormalizedPolicy {
  const root = fields(value, ['version', 'defaults', 'profiles', 'overrides', 'repositories'], 'document');
  if (root['version'] !== 1) fail('version', 'expected 1');
  const defaults = root['defaults'] === undefined ? DEFAULT_ALLOW
    : actions(fields(root['defaults'], ['allow'], 'defaults')['allow'], 'defaults.allow');
  const profiles = root['profiles'] === undefined ? {} : fields(root['profiles'], ['standard', 'isolated'], 'profiles');
  function profile(name: Profile, isolation: 'none' | 'required') {
    const entry = profiles[name] === undefined ? {} : fields(profiles[name], ['allow', 'isolation'], 'profile');
    if (entry['isolation'] !== undefined && entry['isolation'] !== isolation) fail('profile.isolation', 'incompatible isolation');
    return { allow: entry['allow'] === undefined ? defaults : intersect(defaults, actions(entry['allow'], 'profile.allow')), isolation };
  }
  const override = root['overrides'] === undefined ? {} : fields(root['overrides'], ['organizations', 'projects'], 'overrides');
  const repositories = root['repositories'] === undefined ? {} : mapping(root['repositories'], 'repositories');
  const normalizedRepositories = Object.fromEntries(Object.entries(repositories).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
    if (!validProject(key)) fail('repositories', 'invalid project identity');
    const entry = fields(value, ['root'], 'repository'), path = entry['root'];
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) fail('repository.root', 'expected absolute path');
    return [key, { root: path }];
  }));
  return immutable({ version: 1, defaults: { allow: defaults }, profiles: {
    standard: { ...profile('standard', 'none'), isolation: 'none' },
    isolated: { ...profile('isolated', 'required'), isolation: 'required' },
  }, overrides: { organizations: overrides(override['organizations'], false), projects: overrides(override['projects'], true) },
  repositories: normalizedRepositories });
}

export function policyPermissions(policy: NormalizedPolicy, profile: Profile): PolicyPermissions {
  const allow = intersect(policy.defaults.allow, policy.profiles[profile].allow);
  return immutable({ allow,
    organizations: Object.fromEntries(Object.entries(policy.overrides.organizations).map(([key, rule]) => [key, intersect(allow, rule.allow)])),
    projects: Object.fromEntries(Object.entries(policy.overrides.projects).map(([key, rule]) => [key, intersect(allow, rule.allow)])),
  });
}
export function resourcePermissions(permissions: PolicyPermissions, organization?: string, project?: string): readonly Action[] {
  let allow = permissions.allow;
  if (organization && Object.hasOwn(permissions.organizations, organization)) allow = intersect(allow, permissions.organizations[organization]!);
  if (project && Object.hasOwn(permissions.projects, project)) allow = intersect(allow, permissions.projects[project]!);
  return allow;
}
