import { realpathSync } from 'node:fs';
import { isRootRelativePath } from '../infrastructure/filesystem/paths.js';
import type { Backend } from './backend.js';
import type { OperationInput, OperationName } from './operations.js';

export type DeviceBackend = Backend & { raw: Backend; root: string };

export function deviceBackend(inner: Backend, root: string): DeviceBackend {
  const canonical = realpathSync(root).replace(/\/+$/, '');
  return {
    remote: inner.remote,
    device: inner.device,
    raw: inner,
    root: canonical,
    run: async (name, input) => decodePaths(await inner.run(name, encodeInput(name, input, canonical)), canonical),
  };
}

export function isDeviceBackend(b: Backend): b is DeviceBackend {
  return 'raw' in b && 'root' in b;
}

export function toStoredPath(path: string, root: string): string {
  const prefix = root + '/projects/';
  if (!path.startsWith(prefix)) return path;
  const relative = 'projects/' + path.slice(prefix.length);
  return isRootRelativePath(relative) ? relative : path;
}

function encodeInput<K extends OperationName>(name: K, input: OperationInput<K>, root: string): OperationInput<K> {
  const fields = input as Record<string, unknown>;
  if ((name === 'project_add' || name === 'project_update' || name === 'checkout_record') && typeof fields['checkoutPath'] === 'string') {
    return { ...fields, checkoutPath: toStoredPath(fields['checkoutPath'], root) } as OperationInput<K>;
  }
  if (name === 'worktree_record' && typeof fields['worktreePath'] === 'string') {
    return { ...fields, worktreePath: toStoredPath(fields['worktreePath'], root) } as OperationInput<K>;
  }
  const opened = fields['opened'] as { worktree?: unknown } | undefined;
  if (name === 'session_open' && opened !== undefined && typeof opened.worktree === 'string') {
    return { ...fields, opened: { ...opened, worktree: toStoredPath(opened.worktree, root) } } as OperationInput<K>;
  }
  return input;
}

export function decodePaths(value: unknown, root: string): unknown {
  if (Array.isArray(value)) return value.map(item => decodePaths(item, root));
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => {
    if ((key === 'checkoutPath' || key === 'worktreePath') && typeof field === 'string' && isRootRelativePath(field)) return [key, root + '/' + field];
    if (key === 'switched' && field !== null && typeof field === 'object') {
      const switched = field as { worktree?: unknown };
      if (typeof switched.worktree === 'string' && isRootRelativePath(switched.worktree)) {
        return [key, { ...decodePaths(field, root) as object, worktree: root + '/' + switched.worktree }];
      }
    }
    return [key, decodePaths(field, root)];
  }));
}
