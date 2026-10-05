import type { AppCommand } from './commands.js';
import { InputError } from '../shared/errors.js';

// No caller-supplied grant/scope, file input, generic CLI or arbitrary host paths.
export interface WorkerGrant { requestKey: string; contextDir: string; contextReads: readonly string[] }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Object required');
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new InputError('Unsupported argument');
}
function text(value: unknown, max = 100_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError('Invalid text');
  return value;
}
export function relativeResource(value: unknown): string {
  const path = text(value, 4096);
  if (path.includes('\\') || path.includes('\0') || path.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git')) {
    throw new InputError('Invalid resource path');
  }
  return path;
}
export function workerCommand(grant: WorkerGrant, name: string, input: unknown): AppCommand {
  const args = object(input);
  switch (name) {
    case 'request_show':
      fields(args, []); return { name, key: grant.requestKey };
    case 'journal_read': {
      fields(args, ['limit']);
      const limit = args.limit ?? 20;
      if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100) throw new InputError('Invalid limit');
      return { name, scope: { type: 'request', key: grant.requestKey }, limit: limit as number };
    }
    case 'context_read': {
      fields(args, ['path']); const path = relativeResource(args.path);
      if (!path.startsWith(grant.contextDir + '/') && !grant.contextReads.includes(path)) throw new InputError('Resource denied');
      return { name, path };
    }
    case 'request_progress': {
      fields(args, ['text', 'artifacts']);
      const artifacts = args.artifacts ?? [];
      if (!Array.isArray(artifacts) || artifacts.length > 20) throw new InputError('Invalid artifacts');
      return { name, key: grant.requestKey, text: text(args.text), artifacts: artifacts.map(value => {
        const artifact = object(value); fields(artifact, ['path', 'text']);
        const path = relativeResource(artifact.path);
        if (path === 'source.md') throw new InputError('Immutable source');
        return artifact.text === undefined ? { path } : { path, text: text(artifact.text) };
      }) };
    }
    default: throw new InputError('Operation denied');
  }
}
