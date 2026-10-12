import type { Installation } from '../../../dist/src/app/installation.js';
import { installationEnvironment } from '../../../dist/src/app/installation.js';
import { nativeOpeningOutput } from '../../../dist/src/app/native-opening-contract.js';
import type { NativeOpeningResponse } from '../../../dist/src/app/native-opening-contract.js';
import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';

export interface OpeningInput { action?: 'list' | 'open'; organization?: string; project?: string; worktree?: string; allowObservedSession?: boolean }

/** The installed native Pi owns UI; one bounded Node24 CLI invocation owns SQLite/Git/Herdr effects. */
export function nativeOpeningNode(installation: Installation, callerCwd: string, input: OpeningInput,
  signal?: AbortSignal): Promise<NativeOpeningResponse> {
  const entry = join(installation.engineRoot, 'dist/src/cli/main.js');
  const request = JSON.stringify({ installation, callerCwd, ...input,
    ...(basename(process.execPath) === 'pi' ? { nativeExecutable: process.execPath } : {}) });
  if (signal?.aborted) return Promise.resolve({ ok: false, error: { state: 'error', message: 'Opening cancelled before effects' } });
  return new Promise(resolve => {
    execFile('node', [entry, 'project', 'open-native', request], {
      cwd: callerCwd, env: installationEnvironment(installation, process.env), timeout: 45000,
      maxBuffer: 256 * 1024, encoding: 'utf8', shell: false,
    }, (error, stdout) => {
      // The signal is intentionally not passed to execFile: killing Node could interrupt
      // a submitted Herdr operation. The first line is a durable-in-pipe submission
      // checkpoint; on interruption do not discard known target handles.
      resolve(nativeOpeningOutput(stdout, error !== null, signal?.aborted ?? false));
    });
  });
}
