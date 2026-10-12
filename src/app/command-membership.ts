import type { AppCommand, ScopeInput } from './commands.js';
import type { createApp } from './create-app.js';
import { contextScope, resolveScope } from './resolve-scope.js';
import { guardResponse } from '../modules/work-context/public.js';
import type { GuardDecision, GuardPolicy, WorkContext } from '../modules/work-context/public.js';
import type { Scope } from '../shared/scope.js';
import { InputError } from '../shared/errors.js';

export type { GuardPolicy } from '../modules/work-context/public.js';
export interface GuardWarningResult {
  data: unknown;
  warnings: GuardDecision[];
}
// A consumer may retain a selected-policy load failure without disabling discovery.
export type SelectedGuardPolicy = GuardPolicy | Error;

// home_document_patch/status/reconcile are explicitly home-wide operator routes,
// like context maintenance: no project target or inferred membership/default.
export function hasMembershipGuard(command: AppCommand): boolean {
  if (command.name === 'journal_read' && command.scope === 'all') return false;
  return ['project_list', 'warmup', 'memory_show', 'memory_add', 'memory_remove', 'note_add',
    'journal_add', 'journal_read', 'error_add', 'request_create', 'request_list', 'request_show',
    'request_status', 'request_title', 'request_touch', 'request_progress',
    'workspace_prepare', 'workspace_inspect', 'workspace_verify', 'workspace_cleanup_preview', 'workspace_commit', 'workspace_publish'].includes(command.name);
}

/** Observe current registry/card relationships before dispatch; no mutation or Git effects. */
export function commandMembership(command: AppCommand, app: ReturnType<typeof createApp>,
  context: WorkContext, policy: GuardPolicy): {
    command: AppCommand; warnings: GuardDecision[]; listProjectIds?: number[];
  } {
  const projects = app.projects.list(), warnings: GuardDecision[] = [];
  function project(identity: string) {
    const resolved = app.projects.resolveScope(identity);
    if (resolved.type !== 'project') throw new InputError('Project identity required');
    return resolved.project;
  }
  const scope = context.scope;
  if (scope.kind === 'unrestricted') return { command, warnings };
  const selected = context.selectedProject === undefined
    ? (scope.kind === 'project' ? project(scope.project) : undefined) : project(context.selectedProject);
  const members = scope.kind === 'project' ? [project(scope.project)] : app.projects.list(scope.organization);
  if (selected && !members.some(p => p.id === selected.id)) throw new InputError('Selected project is outside the working selection');
  const allowedIds = members.map(p => p.id);
  function contains(id: number | null): boolean { return id !== null && allowedIds.includes(id); }
  function check(allowed: boolean, target: string): void {
    if (allowed) return;
    const decision = guardResponse(policy, 'foreignMypiTarget',
      `mypi: target ${target} is outside the working selection. Select the intended context or use ordinary no-context CLI.`);
    if (decision.behavior === 'block') throw new InputError(decision.message);
    if (decision.behavior === 'warn') warnings.push(decision);
  }
  function request(key: string) {
    const card = app.requests.list().find(card => {
      const code = card.projectId === null ? 'REQ' : projects.find(p => p.id === card.projectId)?.code;
      return `${code}-${card.number}` === key;
    });
    if (!card) throw new InputError('Unknown request key');
    return card;
  }
  const defaultScope: Scope = selected ? { type: 'project', key: selected.code }
    : { type: 'org', key: scope.kind === 'organization' ? scope.organization : members[0]!.org };
  function checkScope(value: Scope, read: boolean): void {
    switch (value.type) {
      case 'global': check(read, 'global'); break;
      case 'org': {
        const organization = app.projects.resolveScope(value.key);
        if (organization.type !== 'org') throw new InputError('Organization scope required');
        const own = scope.kind === 'organization' ? scope.organization === value.key : members[0]!.org === value.key;
        check(own && (read || scope.kind === 'organization'), `organization ${value.key}`);
        break;
      }
      case 'project': {
        const target = projects.find(p => p.code === value.key);
        if (!target) throw new InputError('Unknown project');
        check(contains(target.id), `project ${target.org}/${target.slug}`);
        break;
      }
      case 'request': check(contains(request(value.key).projectId), `request ${value.key}`); break;
    }
  }
  switch (command.name) {
    case 'project_list': {
      if (command.org !== undefined) {
        app.projects.list(command.org); // Preserve explicit invalid-filter diagnostics.
        const own = scope.kind === 'organization' ? scope.organization : members[0]!.org;
        check(command.org === own, `organization ${command.org}`);
        if (command.org !== own) return { command, warnings };
        return { command, warnings, listProjectIds: allowedIds };
      }
      return { command, warnings, listProjectIds: selected ? [selected.id] : allowedIds };
    }
    case 'request_list':
      if (command.project !== undefined) {
        check(contains(project(command.project).id), `project ${command.project}`);
        return { command, warnings };
      }
      return { command, warnings, listProjectIds: selected ? [selected.id] : allowedIds };
    case 'request_create': {
      if (command.project === undefined) {
        if (!selected) throw new InputError('Select a concrete project or supply an explicit project for request creation');
        command = { ...command, project: selected.org + '/' + selected.slug };
      }
      check(command.project != null && contains(project(command.project).id), `project ${command.project ?? 'standalone'}`);
      break;
    }
    case 'request_show': case 'request_status': case 'request_title': case 'request_touch': case 'request_progress':
      check(contains(request(command.key).projectId), `request ${command.key}`); break;
    case 'workspace_prepare': case 'workspace_inspect': case 'workspace_verify': case 'workspace_cleanup_preview': case 'workspace_commit': case 'workspace_publish':
    case 'error_add': check(contains(project(command.project).id), `project ${command.project}`); break;
    case 'warmup': case 'memory_show': case 'memory_add': case 'memory_remove': case 'note_add': {
      const input: ScopeInput = command.scope ?? defaultScope;
      const resolved = app.projects.resolveScope(contextScope(input, app.projects));
      checkScope(resolved.type === 'global' ? { type: 'global' } : resolved.type === 'org'
        ? { type: 'org', key: resolved.slug } : { type: 'project', key: resolved.project.code },
      command.name === 'warmup' || command.name === 'memory_show');
      command = { ...command, scope: input };
      break;
    }
    case 'journal_add': case 'journal_read': {
      if (command.scope === 'all') break;
      const input = command.scope ?? defaultScope;
      checkScope(resolveScope(input, app.projects), command.name === 'journal_read');
      command = { ...command, scope: input };
      break;
    }
  }
  return { command, warnings };
}
