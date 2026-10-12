import { InputError } from '../shared/errors.js';
import type { Installation } from './installation.js';
import type { ProjectOpeningSelection } from './project-opening.js';
import type { HerdrSubmission } from './herdr.js';

export interface NativeOpeningRequest {
  installation: Installation;
  callerCwd: string;
  action?: 'list' | 'open';
  organization?: string;
  project?: string;
  worktree?: string;
  allowObservedSession?: boolean;
  nativeExecutable?: string;
}
export type NativeOpeningError = { state: 'error' | 'observed-conflict' | 'partial'; message: string;
  conflicts?: { instanceKey: string; status: string }[]; stage?: string; tabId?: string;
  paneId?: string; herdrSocketPath?: string };
export type NativeOpeningResponse = { ok: true; value: ProjectOpeningSelection | { state: 'organization'; organization: string } | {
  state: 'submitted' | 'ready' | 'failed'; receipt: HerdrSubmission;
  choice?: { project: string; worktree: string; branch: string }; organization?: string; cwd?: string } }
  | { ok: false; error: NativeOpeningError };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseNativeOpeningRequest(value: unknown): NativeOpeningRequest {
  if (!record(value) || !record(value.installation) || typeof value.callerCwd !== 'string'
    || !value.callerCwd.startsWith('/') || (value.project !== undefined && typeof value.project !== 'string')
    || (value.action !== undefined && !['list', 'open'].includes(String(value.action)))
    || (value.organization !== undefined && typeof value.organization !== 'string')
    || (value.worktree !== undefined && typeof value.worktree !== 'string')
    || (value.allowObservedSession !== undefined && typeof value.allowObservedSession !== 'boolean')
    || (value.nativeExecutable !== undefined && (typeof value.nativeExecutable !== 'string' || !value.nativeExecutable.startsWith('/')))
    || Object.keys(value).some(key => !['installation', 'callerCwd', 'action', 'organization', 'project', 'worktree', 'allowObservedSession', 'nativeExecutable'].includes(key))) {
    throw new InputError('Invalid native project opening request');
  }
  if (value.organization !== undefined && (value.project !== undefined || value.worktree !== undefined))
    throw new InputError('Choose an organization or a project, not both');
  if (value.worktree !== undefined && value.project === undefined) throw new InputError('Worktree requires a project');
  if (value.action === 'open' && value.organization === undefined && value.project === undefined)
    throw new InputError('Opening requires an organization or project');
  if (value.action === 'list' && value.allowObservedSession !== undefined)
    throw new InputError('Listing cannot allow observed sessions');
  if (value.organization !== undefined && value.action === undefined && value.allowObservedSession !== undefined)
    throw new InputError('Organization opening requires explicit action: open');
  return value as unknown as NativeOpeningRequest;
}
export function nativeOpeningMode(request: NativeOpeningRequest): 'list' | 'open' {
  return request.action ?? (request.project !== undefined && request.worktree !== undefined ? 'open' : 'list');
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const choice = (value: unknown): boolean => record(value) && nonempty(value.project)
  && nonempty(value.worktree) && nonempty(value.branch);
export function nativeOpeningReceipt(stdout: string, failed: boolean, aborted: boolean): NativeOpeningResponse {
  let response: NativeOpeningResponse;
  try { response = parseNativeOpeningResponse(JSON.parse(stdout) as unknown); }
  catch { return { ok: false, error: { state: 'partial', stage: 'unknown',
    message: 'Node opening acknowledgement missing or invalid; inspect Herdr before retrying.' } }; }
  if (!failed && !aborted || !response.ok && (response.error.state === 'partial'
    || response.error.state === 'error' && !aborted)) return response;
  const receipt = response.ok && (response.value.state === 'submitted' || response.value.state === 'ready' || response.value.state === 'failed') ? response.value.receipt : undefined;
  return { ok: false, error: { state: 'partial', stage: 'unknown',
    message: 'Node opening execution interrupted or cancelled; inspect Herdr before retrying.',
    ...(receipt ? { herdrSocketPath: receipt.herdrSocketPath, tabId: receipt.tabId, paneId: receipt.paneId } : {}) } };
}

export function nativeOpeningOutput(stdout: string, failed: boolean, aborted: boolean): NativeOpeningResponse {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const response = nativeOpeningReceipt(lines.at(-1) ?? '', failed, aborted);
  if (response.ok || response.error.state === 'observed-conflict' || lines.length < 2
    || response.error.state === 'partial' && response.error.stage !== 'unknown') return response;
  const checkpoint = nativeOpeningReceipt(lines[0]!, false, false);
  if (checkpoint.ok || checkpoint.error.state !== 'partial' || checkpoint.error.stage !== 'startup') return response;
  return { ok: false, error: { ...checkpoint.error,
    message: response.error.state === 'error' ? response.error.message + ' Inspect the retained target before retrying.'
      : 'Node opening interrupted after submission; inspect the target before retrying.' } };
}

export function parseNativeOpeningResponse(value: unknown): NativeOpeningResponse {
  if (!record(value) || typeof value.ok !== 'boolean') throw new InputError('Invalid native project opening response');
  if (value.ok) {
    if (!record(value.value) || !['projects', 'choices', 'selected', 'organization', 'submitted', 'ready', 'failed'].includes(String(value.value.state))
      || (value.value.state === 'projects' && (!Array.isArray(value.value.organizations)
        || !value.value.organizations.every(item => typeof item === 'string') || !Array.isArray(value.value.projects)
        || !value.value.projects.every(item => typeof item === 'string') || typeof value.value.message !== 'string'))
      || (value.value.state === 'choices' && (!Array.isArray(value.value.choices)
        || !value.value.choices.every(choice) || typeof value.value.message !== 'string'))
      || (value.value.state === 'selected' && !choice(value.value.choice))
      || (value.value.state === 'organization' && !nonempty(value.value.organization))
      || ((value.value.state === 'submitted' || value.value.state === 'ready' || value.value.state === 'failed') && (!(choice(value.value.choice)
        || (nonempty(value.value.organization) && nonempty(value.value.cwd))) || !record(value.value.receipt)
        || value.value.receipt.status !== value.value.state
        || (value.value.state === 'ready' && value.value.receipt.observation !== 'confirmed')
        || (value.value.state === 'submitted' && value.value.receipt.observation !== undefined
          && value.value.receipt.observation !== 'disabled' && value.value.receipt.observation !== 'unavailable'
          && value.value.receipt.observation !== 'timeout')
        || (value.value.state === 'failed' && !['closed', 'exit-nonzero', 'exited'].includes(String(value.value.receipt.observation)))
        || (value.value.receipt.exitCode !== undefined && (typeof value.value.receipt.exitCode !== 'number' || !Number.isInteger(value.value.receipt.exitCode)
          || value.value.receipt.exitCode < 0 || value.value.receipt.exitCode > 255
          || value.value.state !== 'failed'
          || (value.value.receipt.exitCode === 0 ? value.value.receipt.observation !== 'exited' : value.value.receipt.observation !== 'exit-nonzero')))
        || ((value.value.receipt.observation === 'exited' || value.value.receipt.observation === 'exit-nonzero')
          && value.value.receipt.exitCode === undefined)
        || !nonempty(value.value.receipt.tabId)
        || !nonempty(value.value.receipt.paneId) || !nonempty(value.value.receipt.herdrSocketPath)
        || (value.value.receipt.observation !== undefined && !['disabled', 'unavailable', 'timeout', 'confirmed', 'closed', 'exit-nonzero', 'exited'].includes(String(value.value.receipt.observation)))))) {
      throw new InputError('Invalid native project opening result');
    }
    return value as NativeOpeningResponse;
  }
  if (!record(value.error) || !['error', 'observed-conflict', 'partial'].includes(String(value.error.state))
    || typeof value.error.message !== 'string'
    || (value.error.state === 'observed-conflict' && !Array.isArray(value.error.conflicts))
    || (value.error.state === 'partial' && (!['create', 'submit', 'startup', 'focus', 'title'].includes(String(value.error.stage))
      || typeof value.error.herdrSocketPath !== 'string'))) throw new InputError('Invalid native project opening error');
  return value as NativeOpeningResponse;
}
