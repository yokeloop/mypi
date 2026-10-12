import type { HomeRecovery } from './home-writer.js';

export interface ContextFiles {
  read(path: string): string | undefined;
  isFile(path: string): boolean;
  list(path: string): string[];
  create(path: string, text: string): void;
  replace(path: string, text: string, expected: string): void;
  append(path: string, text: string): void;
}
export interface ContextHistory {
  validate(paths: string[]): void;
  clean(paths: string[]): void;
  commit(paths: string[], message: string): string;
}
export class PartialError extends Error {
  override name = 'PartialError';
  readonly status = 'partial';
  constructor(message: string, readonly saved: string[], readonly missing: string[],
    readonly paths: string[], readonly requestId?: number, public home?: HomeRecovery) { super(message); }
}
