import type { createProjects } from '../modules/projects/public.js';
import type { ScopeInput } from './commands.js';
import { scopeValue } from '../shared/scope.js';
import type { Scope } from '../shared/scope.js';
import { InputError } from '../shared/errors.js';

type Projects = ReturnType<typeof createProjects>;
export function resolveScope(input: ScopeInput, projects: Projects): Scope {
  if (!('reference' in input)) return scopeValue(input);
  const value = input.reference;
  if (value === 'global') return { type: 'global' };
  if (value.includes(':')) {
    const [type, key, extra] = value.split(':');
    if (extra !== undefined) throw new InputError('Invalid scope');
    return scopeValue({ type, key });
  }
  const resolved = projects.resolveScope(value);
  if (resolved.type === 'project') return { type: 'project', key: resolved.project.code };
  if (resolved.type === 'org') return { type: 'org', key: resolved.slug };
  return { type: 'global' };
}
export function contextScope(input: ScopeInput, projects: Projects): string | undefined {
  // Context CLI historically takes an organization slug or org/project, not journal syntax.
  // In particular an organization named "global" and an explicit empty string are not defaults.
  if ('reference' in input) { projects.resolveScope(input.reference); return input.reference; }
  const scope = resolveScope(input, projects);
  if (scope.type === 'global') return undefined;
  if (scope.type === 'request') throw new InputError('Context scope cannot be request');
  if (scope.type === 'org') { projects.resolveScope(scope.key); return scope.key; }
  const project = projects.list().find(p => p.code === scope.key);
  if (!project) throw new InputError('Unknown project');
  return project.org + '/' + project.slug;
}
