import { InputError } from '../../shared/errors.js';

export interface Project {
  id: number;
  org: string;
  slug: string;
  code: string;
  checkoutPath: string | null;
}

export type ProjectScope =
  | { type: 'global' }
  | { type: 'org'; id: number; slug: string }
  | { type: 'project'; project: Project };

export function parseIdentity(identity: string): { org: string; slug: string } {
  const parts = identity.split('/');
  if (parts.length !== 2 || !parts.every(validSlug)) {
    throw new InputError('Expected org/project; each segment must be a lowercase slug');
  }
  return { org: parts[0]!, slug: parts[1]! };
}

export function validSlug(value: string): boolean {
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value);
}

export function validateCode(code: string): void {
  if (!/^[A-Z]+$/.test(code) || code === 'REQ') {
    throw new InputError('Project code must contain A–Z only; REQ is reserved');
  }
}
