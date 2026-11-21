import { tmpdir } from 'node:os';

export function runtimeDir(env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform, tmp: () => string = tmpdir): string | undefined {
  const value = env['XDG_RUNTIME_DIR'];
  return platform === 'darwin' && !value ? tmp() : value;
}
