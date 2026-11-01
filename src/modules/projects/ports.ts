import type { Project } from './model.js';

export interface ProjectStore {
  add(input: { org: string; slug: string; code: string; checkoutPath: string | null; repository: string | null }): Project;
  update(input: { org: string; slug: string; checkout?: { expected: string | null; path: string };
    repository?: { expected: string | null; value: string } }): Project;
  list(org?: string): Project[];
  find(org: string, slug: string): Project | undefined;
  findOrganization(slug: string): { id: number; slug: string } | undefined;
  remove(input: { org: string; slug: string; expectedCode: string }): Project;
  removeOrganization(slug: string): void;
}

export interface CheckoutPaths {
  canonicalDirectory(path: string): string;
  canonicalAbsoluteDirectory(path: string): string;
}
