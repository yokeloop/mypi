import { InputError } from './errors.js';

export const WORKSPACE_CHECK_CONFIG = '.mypi-checks.json';
export interface WorkspaceCheckConfig { version: 1; commands: { argv: string[] }[] }
export interface WorkspaceCheckOutcome { argv: string[]; exitCode: number | null; outcome: 'passed' | 'failed' | 'interrupted' }
export interface WorkspaceCheckCache {
  version: 1;
  binding: string;
  state: 'running' | 'passed' | 'failed' | 'unavailable';
  content: string | null;
  startedAt: string;
  outcomes: WorkspaceCheckOutcome[];
}
export type WorkspaceCheckState = 'absent' | 'unavailable' | 'interrupted' | 'failed' | 'stale' | 'current';

export function parseWorkspaceCheckConfig(value: unknown): WorkspaceCheckConfig {
  const fail = (): never => { throw new InputError('Checked material unavailable: invalid .mypi-checks.json'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const config = value as Record<string, unknown>;
  if (Object.keys(config).sort().join(',') !== 'commands,version' || config['version'] !== 1
    || !Array.isArray(config['commands']) || !config['commands'].length || config['commands'].length > 8) return fail();
  for (const command of config['commands']) {
    if (!command || typeof command !== 'object' || Object.keys(command).join(',') !== 'argv'
      || !Array.isArray(command.argv) || !command.argv.length || command.argv.length > 64
      || command.argv.some((arg: unknown) => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))
      || !command.argv[0]) return fail();
  }
  return config as unknown as WorkspaceCheckConfig;
}

/** Convenience freshness only: not authorization, toolchain attestation or writer ownership. */
export function workspaceCheckState(cache: WorkspaceCheckCache | null, binding: string, content: string | null): WorkspaceCheckState {
  if (!cache) return 'absent';
  if (cache.binding !== binding) return 'stale';
  if (cache.state === 'running') return 'interrupted';
  if (cache.state === 'failed') return 'failed';
  if (cache.state === 'unavailable' || content === null) return 'unavailable';
  return cache.content === content ? 'current' : 'stale';
}
