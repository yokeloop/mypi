import { fileURLToPath } from 'node:url';
import { resolveInstallation } from './installation.js';
import { nativeOpeningMode, parseNativeOpeningRequest } from './native-opening-contract.js';
import { projectOpeningChoices, organizationOpeningChoice, openProjectPi, openOrganizationPi, ObservedSessionConflict } from './project-opening-terminal.js';
import { HerdrPartialError } from './herdr.js';
import { InputError } from '../shared/errors.js';
import type { NativeOpeningResponse } from './native-opening-contract.js';

/** Node-only CLI dispatch. No DB or Herdr effects before checking the captured binding. */
export function nativeOpeningFailure(error: unknown): NativeOpeningResponse {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ObservedSessionConflict) return { ok: false,
    error: { state: 'observed-conflict', message, conflicts: error.conflicts } };
  if (error instanceof HerdrPartialError) return { ok: false,
    error: { state: 'partial', message, stage: error.stage, herdrSocketPath: error.herdrSocketPath,
      ...(error.tabId === undefined ? {} : { tabId: error.tabId }),
      ...(error.paneId === undefined ? {} : { paneId: error.paneId }) } };
  return { ok: false, error: { state: 'error', message } };
}

export async function executeNativeOpening(raw: string): Promise<NativeOpeningResponse> {
  try {
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new InputError('Native opening requires Node 24');
    const request = parseNativeOpeningRequest(JSON.parse(raw) as unknown);
    const captured = request.installation;
    const engineRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const current = resolveInstallation(engineRoot, process.env);
    if (Object.keys(current).some(key => current[key as keyof typeof current] !== captured[key as keyof typeof current])) {
      throw new InputError('Installation changed after native selection; review binding and retry explicitly');
    }
    const opening = nativeOpeningMode(request) === 'open';
    const value = opening
      ? request.organization !== undefined
        ? await openOrganizationPi(current, request.callerCwd, request.organization, request.allowObservedSession)
        : await openProjectPi(current, request.callerCwd, request.project!, request.worktree, request.allowObservedSession)
      : request.organization !== undefined
        ? organizationOpeningChoice(current, request.organization)
        : projectOpeningChoices(current, request.project, request.worktree);
    return { ok: true, value };
  } catch (error) { return nativeOpeningFailure(error); }
}
