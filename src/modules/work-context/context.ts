export type WorkScope =
  | { readonly kind: 'project'; readonly project: string }
  | { readonly kind: 'organization'; readonly organization: string }
  | { readonly kind: 'unrestricted' };

/** Working selection, not authority. Project identities use org/project spelling. */
export interface WorkContext {
  readonly scope: WorkScope;
  // Project scope already selects its project; an explicit selection must agree.
  // Consumers validate selection and worktree consistency at their input boundary.
  readonly selectedProject?: string;
  readonly worktreeRoot?: string;
}

/**
 * For organization scope, the consumer supplies current registry members of
 * scope.organization on each call. This observation is not an authority snapshot.
 */
export function scopeContainsProject(
  scope: WorkScope, project: string, currentOrganizationProjects: readonly string[],
): boolean {
  switch (scope.kind) {
    case 'project': return scope.project === project;
    case 'organization': return currentOrganizationProjects.includes(project);
    case 'unrestricted': return true;
  }
}
