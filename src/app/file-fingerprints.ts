import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ContextFiles } from '../shared/context.js';
import type { FileFingerprint } from '../modules/knowledge/public.js';
import { InputError } from '../shared/errors.js';

export function fileFingerprint(files: ContextFiles & { path(path: string): string }, path: string, at: string): FileFingerprint {
  if (!files.isFile(path)) throw new InputError('Missing referenced file');
  const bytes = readFileSync(files.path(path));
  return { path, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, registeredAt: at };
}

export function matchesFingerprint(saved: FileFingerprint, current: FileFingerprint): void {
  if (saved.sha256 !== current.sha256 || saved.byteLength !== current.byteLength) throw new InputError('Registered file changed: ' + saved.path);
}
