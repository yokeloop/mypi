import { InputError } from '../shared/errors.js';
import type { Installation } from './installation.js';
import type { ProjectOpeningSelection } from './project-opening.js';
import type { HerdrSubmission } from './herdr.js';

export interface NativeOpeningRequest {
  installation: Installation;
  callerCwd: string;
  project?: string;
  worktree?: string;
  allowObservedSession?: boolean;
}
export type NativeOpeningError = { state: 'error' | 'observed-conflict' | 'partial'; message: string;
  conflicts?: { instanceKey: string; status: string }[]; stage?: string; tabId?: string;
  paneId?: string; herdrSocketPath?: string };
export type NativeOpeningResponse = { ok: true; value: ProjectOpeningSelection | {
  state: 'submitted'; choice: { project: string; worktree: string; branch: string }; receipt: HerdrSubmission } }
  | { ok: false; error: NativeOpeningError };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseNativeOpeningRequest(value: unknown): NativeOpeningRequest {
  if (!record(value) || !record(value.installation) || typeof value.callerCwd !== 'string'
    || !value.callerCwd.startsWith('/') || (value.project !== undefined && typeof value.project !== 'string')
    || (value.worktree !== undefined && typeof value.worktree !== 'string')
    || (value.allowObservedSession !== undefined && typeof value.allowObservedSession !== 'boolean')
    || Object.keys(value).some(key => !['installation', 'callerCwd', 'project', 'worktree', 'allowObservedSession'].includes(key))) {
    throw new InputError('Invalid native project opening request');
  }
  return value as unknown as NativeOpeningRequest;
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const choice = (value: unknown): boolean => record(value) && nonempty(value.project)
  && nonempty(value.worktree) && nonempty(value.branch);
export function nativeOpeningReceipt(stdout: string, failed: boolean, aborted: boolean): NativeOpeningResponse {
  let response: NativeOpeningResponse;
  try { response = parseNativeOpeningResponse(JSON.parse(stdout) as unknown); }
  catch { return { ok: false, error: { state: 'partial', stage: 'unknown',
    message: 'Node opening acknowledgement missing or invalid; inspect Herdr before retrying.' } }; }
  if (!failed && !aborted || !response.ok && response.error.state === 'partial') return response;
  const receipt = response.ok && response.value.state === 'submitted' ? response.value.receipt : undefined;
  return { ok: false, error: { state: 'partial', stage: 'unknown',
    message: 'Node opening execution interrupted or cancelled; inspect Herdr before retrying.',
    ...(receipt ? { herdrSocketPath: receipt.herdrSocketPath, tabId: receipt.tabId, paneId: receipt.paneId } : {}) } };
}

export function parseNativeOpeningResponse(value: unknown): NativeOpeningResponse {
  if (!record(value) || typeof value.ok !== 'boolean') throw new InputError('Invalid native project opening response');
  if (value.ok) {
    if (!record(value.value) || !['projects', 'choices', 'submitted'].includes(String(value.value.state))
      || (value.value.state === 'projects' && (!Array.isArray(value.value.projects)
        || !value.value.projects.every(item => typeof item === 'string') || typeof value.value.message !== 'string'))
      || (value.value.state === 'choices' && (!Array.isArray(value.value.choices)
        || !value.value.choices.every(choice) || typeof value.value.message !== 'string'))
      || (value.value.state === 'submitted' && (!choice(value.value.choice) || !record(value.value.receipt)
        || value.value.receipt.status !== 'submitted' || !nonempty(value.value.receipt.tabId)
        || !nonempty(value.value.receipt.paneId) || !nonempty(value.value.receipt.herdrSocketPath)))) {
      throw new InputError('Invalid native project opening result');
    }
    return value as NativeOpeningResponse;
  }
  if (!record(value.error) || !['error', 'observed-conflict', 'partial'].includes(String(value.error.state))
    || typeof value.error.message !== 'string'
    || (value.error.state === 'observed-conflict' && !Array.isArray(value.error.conflicts))
    || (value.error.state === 'partial' && (!['create', 'submit', 'focus', 'title'].includes(String(value.error.stage))
      || typeof value.error.herdrSocketPath !== 'string'))) throw new InputError('Invalid native project opening error');
  return value as NativeOpeningResponse;
}
