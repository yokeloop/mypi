import { isAbsolute, normalize, relative } from 'node:path';
import type { WorkContext, WorkScope } from '../modules/work-context/public.js';
import { InputError } from '../shared/errors.js';

export const MYPI_PI_CONTEXT = 'MYPI_PI_CONTEXT';
export const MYPI_MCP_CONTEXT = 'MYPI_MCP_CONTEXT';
export const PI_CONTEXT_ENTRY = 'mypi.work-context';

export interface PiContextData {
  readonly version: 1;
  readonly cwd: string;
  readonly context: WorkContext;
}
export interface PiBranchEntry { readonly type: string; readonly customType?: string; readonly data?: unknown }
export type PiContextSelection = { readonly state: 'selected'; readonly data: PiContextData }
  | { readonly state: 'absent' | 'invalid' | 'cwd-mismatch' };

function mapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
const slug = '[a-z0-9]+(?:[._-][a-z0-9]+)*';
const identity = new RegExp(`^${slug}/${slug}$`);
function project(value: unknown): value is string { return typeof value === 'string' && identity.test(value); }
function path(value: unknown): value is string {
  return typeof value === 'string' && isAbsolute(value) && normalize(value) === value && !/[\x00-\x1f\x7f]/.test(value);
}

/** Parse extension data, not registry membership or repository evidence. Return a detached immutable selection. */
export function parsePiContext(value: unknown): PiContextData | undefined {
  if (!mapping(value) || !keys(value, ['version', 'cwd', 'context']) || value.version !== 1 || !path(value.cwd)) return;
  const context = value.context;
  if (!mapping(context) || !keys(context, ['scope', 'selectedProject', 'worktreeRoot']) || !mapping(context.scope)) return;
  const scope = context.scope;
  let selection: WorkScope;
  if (scope.kind === 'project' && keys(scope, ['kind', 'project']) && project(scope.project)) {
    selection = { kind: 'project', project: scope.project };
  } else if (scope.kind === 'organization' && keys(scope, ['kind', 'organization'])
    && typeof scope.organization === 'string' && new RegExp(`^${slug}$`).test(scope.organization)) {
    selection = { kind: 'organization', organization: scope.organization };
  } else if (scope.kind === 'unrestricted' && keys(scope, ['kind'])) {
    selection = { kind: 'unrestricted' };
  } else return;
  const selected = context.selectedProject;
  if ('selectedProject' in context && !project(selected)) return;
  if (typeof selected === 'string' && (selection.kind === 'project' && selected !== selection.project
    || selection.kind === 'organization' && !selected.startsWith(selection.organization + '/'))) return;
  if ('worktreeRoot' in context) {
    if (!path(context.worktreeRoot) || (selection.kind !== 'project' && selected === undefined)) return;
    const child = relative(context.worktreeRoot, value.cwd);
    if (child === '..' || child.startsWith('../') || isAbsolute(child)) return;
  }
  return Object.freeze({ version: 1, cwd: value.cwd, context: Object.freeze({ scope: Object.freeze(selection),
    ...(typeof selected === 'string' ? { selectedProject: selected } : {}),
    ...(typeof context.worktreeRoot === 'string' ? { worktreeRoot: context.worktreeRoot } : {}),
  }) });
}

/** Transport escaping only: Pi interpolates plain MCP env strings. This is neither secret nor authenticated. */
export function encodePiContext(data: PiContextData): string {
  const parsed = parsePiContext(data);
  if (!parsed) throw new InputError('Invalid Pi working context');
  return Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url');
}
export function decodePiContext(envelope: string): PiContextData {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(envelope)) throw new Error();
    const bytes = Buffer.from(envelope, 'base64url');
    if (bytes.toString('base64url') !== envelope) throw new Error();
    const data = parsePiContext(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (data) return data;
  } catch { /* One stable diagnostic; never echo input. */ }
  throw new InputError('Invalid Pi working context envelope');
}

/** Only the active branch, in native root-to-leaf order. An invalid latest entry must not revive an older selection. */
export function selectPiContext(branch: readonly PiBranchEntry[], cwd: string): PiContextSelection {
  const entry = branch.findLast(item => item.type === 'custom' && item.customType === PI_CONTEXT_ENTRY);
  if (!entry) return { state: 'absent' };
  const data = parsePiContext(entry.data);
  if (!data) return { state: 'invalid' };
  return data.cwd === cwd ? { state: 'selected', data } : { state: 'cwd-mismatch' };
}

/** Missing means legacy composition; empty is an explicit clear, not a malformed-envelope fallback. */
export function mcpWorkContext(envelope: string | undefined): WorkContext | undefined {
  return envelope === undefined || envelope === '' ? undefined : decodePiContext(envelope).context;
}
