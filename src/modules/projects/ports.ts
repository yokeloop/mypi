import type { Project } from './model.js';

export interface ProjectStore {
  add(input: { org: string; slug: string; code: string; checkoutPath: string | null }): Project;
  updateCheckout(input: { org: string; slug: string; expectedCheckoutPath: string | null; checkoutPath: string }): Project;
  list(org?: string): Project[];
  find(org: string, slug: string): Project | undefined;
  findOrganization(slug: string): { id: number; slug: string } | undefined;
}

export interface CheckoutPaths {
  canonicalDirectory(path: string): string;
  canonicalAbsoluteDirectory(path: string): string;
}
