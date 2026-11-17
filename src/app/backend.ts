import type { ServerConfig } from '../infrastructure/filesystem/server-config.js';
import type { OperationInput, OperationName } from './operations.js';

export type { ServerConfig };
export type Backend = { remote: boolean; run<K extends OperationName>(name: K, input: OperationInput<K>): Promise<unknown> };

export function remoteBackend(_config: ServerConfig): Backend {
  return { remote: true, run: async () => { throw new Error('Not implemented'); } };
}

export function deviceName(_config: ServerConfig | undefined): string {
  throw new Error('Not implemented');
}
