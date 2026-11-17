import { hostname } from 'node:os';
import { readServerConfig } from '../infrastructure/filesystem/server-config.js';
import type { ServerConfig } from '../infrastructure/filesystem/server-config.js';
import { serverConfigPath } from '../infrastructure/filesystem/paths.js';
import { InputError } from '../shared/errors.js';
import { engineVersion } from './create-app.js';
import { runOperation } from './operations.js';
import type { OperationInput, OperationName } from './operations.js';
import type { SessionRunner } from './session-operations.js';

export type { ServerConfig };
export type Backend = { remote: boolean; device: string; run<K extends OperationName>(name: K, input: OperationInput<K>): Promise<unknown> };

export function localBackend(filename: string, root?: string): Backend {
  return { remote: false, device: hostname(), run: async (name, input) => runOperation({ filename, ...(root === undefined ? {} : { root }) }, name, input) };
}

export function remoteBackend(config: ServerConfig, version = engineVersion(), timeoutMs = 10_000): Backend {
  return {
    remote: true,
    device: deviceName(config),
    run: async (name, input) => {
      let text: string;
      try {
        const response = await fetch(config.url + '/v1/ops', { method: 'POST',
          headers: { authorization: 'Bearer ' + config.token, 'content-type': 'application/json' },
          body: JSON.stringify({ op: name, input, version }), signal: AbortSignal.timeout(timeoutMs) });
        text = await response.text();
      } catch { throw new Error('mypi server unreachable: ' + config.url); }
      let body: { data?: unknown; error?: { code?: unknown; message?: unknown } };
      try { body = JSON.parse(text) as typeof body; } catch { throw new Error('Invalid response from mypi server: ' + config.url); }
      if (body === null || typeof body !== 'object') throw new Error('Invalid response from mypi server: ' + config.url);
      if (body.error !== undefined) {
        const message = String(body.error.message);
        throw body.error.code === 'invalid_request' || body.error.code === 'version_mismatch' ? new InputError(message) : new Error(message);
      }
      return body.data;
    },
  };
}

export function configuredServer(env: Readonly<Record<string, string | undefined>>): ServerConfig | undefined {
  const path = serverConfigPath(env);
  return path === undefined ? undefined : readServerConfig(path);
}

export function deviceName(config: ServerConfig | undefined): string {
  return config?.device ?? hostname();
}

export function sessionRunner(backend: Backend): SessionRunner {
  return { remote: backend.remote, device: backend.device, run: (name, input) => backend.run(name, input as never) as Promise<never> };
}
