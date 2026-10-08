import type { Project } from './model.js';

export interface ProjectStore {
  add(input: { org: string; slug: string; code: string; checkoutPath: string | null }): Project;
  list(org?: string): Project[];
  find(org: string, slug: string): Project | undefined;
  findOrganization(slug: string): { id: number; slug: string } | undefined;
}

export interface CheckoutPaths {
  canonicalDirectory(path: string): string;
}

/** Canonical, read-only observations supplied by a trusted Git adapter. */
export interface RepositoryEvidence {
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly primary: boolean;
  readonly bare: boolean;
  readonly branch: string | null;
  readonly head: string;
}
export interface WorktreeEvidence {
  /** Null when a listed root is missing/unusable; never infer membership by prefix. */
  readonly root: string | null;
  readonly branch: string | null;
  readonly head: string | null;
  readonly bare: boolean;
  readonly detached: boolean;
  readonly prunable: boolean;
  readonly locked: boolean;
}
export interface RepositoryIdentityReader {
  inspect(root: string): RepositoryEvidence;
  worktrees(baseRoot: string): readonly WorktreeEvidence[];
}
