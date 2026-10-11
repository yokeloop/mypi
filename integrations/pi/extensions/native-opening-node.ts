import type { Installation } from '../../../dist/src/app/installation.js';
import { installationEnvironment } from '../../../dist/src/app/installation.js';
import { nativeOpeningReceipt } from '../../../dist/src/app/native-opening-contract.js';
import type { NativeOpeningResponse } from '../../../dist/src/app/native-opening-contract.js';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

export interface OpeningInput { project?: string; worktree?: string; allowObservedSession?: boolean }

/** The installed native Pi owns UI; one bounded Node24 CLI invocation owns SQLite/Git/Herdr effects. */
export function nativeOpeningNode(installation: Installation, callerCwd: string, input: OpeningInput,
  signal?: AbortSignal): Promise<NativeOpeningResponse> {
  const entry = join(installation.engineRoot, 'dist/src/cli/main.js');
  const request = JSON.stringify({ installation, callerCwd, ...input });
  if (signal?.aborted) return Promise.resolve({ ok: false, error: { state: 'error', message: 'Opening cancelled before effects' } });
  return new Promise(resolve => {
    execFile('node', [entry, 'project', 'open-native', request], {
      cwd: callerCwd, env: installationEnvironment(installation, process.env), timeout: 45000,
      maxBuffer: 256 * 1024, encoding: 'utf8', shell: false,
    }, (error, stdout) => {
      // The signal is intentionally not passed to execFile: killing Node could interrupt
      // a submitted Herdr operation. A late abort reports uncertainty, not rollback.
      resolve(nativeOpeningReceipt(stdout, error !== null, signal?.aborted ?? false));
    });
  });
}
