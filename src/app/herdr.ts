import { isAbsolute } from 'node:path';
import { InputError } from '../shared/errors.js';
import type { WorkContext } from '../modules/work-context/public.js';
import { encodePiContext, MYPI_PI_CONTEXT, MYPI_MCP_CONTEXT } from './pi-context.js';
import { MYPI_MCP_NATIVE_SESSION_ID } from './pi-message-caller.js';
import type { PiLaunchPlan } from './pi-launcher.js';
import type { SessionSelection, SessionShow } from './session-cards.js';
import { herdrId, observeHerdr } from './herdr-observation.js';

export interface HerdrCliReceipt { code: 0; stdout: string }
export type HerdrRunner = (args: readonly string[]) => HerdrCliReceipt;
export type HerdrControl = SessionSelection & { instanceKey: string } &
  ({ action: 'focus' } | { action: 'title'; title: string });
export interface HerdrSubmission { status: 'submitted'; herdrSocketPath: string; tabId: string; paneId: string }
export class HerdrPartialError extends Error {
  readonly status = 'partial';
  constructor(readonly stage: 'create' | 'submit' | 'focus' | 'title',
    readonly herdrSocketPath: string, readonly tabId?: string, readonly paneId?: string) {
    super('Herdr operation may have taken effect. Inspect the explicit server/known IDs before choosing another action; do not blindly retry.');
  }
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InputError('Invalid Herdr acknowledgement');
  return value as Record<string, unknown>;
}
function result(receipt: HerdrCliReceipt, type: string): Record<string, unknown> {
  if (receipt.code !== 0) throw new InputError('Unsuccessful Herdr CLI receipt');
  let value: unknown;
  try { value = JSON.parse(receipt.stdout) as unknown; }
  catch { throw new InputError('Invalid Herdr JSON acknowledgement'); }
  const envelope = object(value), data = object(envelope['result']);
  if (envelope['error'] !== undefined || data['type'] !== type) throw new InputError('Unexpected Herdr acknowledgement');
  return data;
}
function tab(value: unknown): { tabId: string; workspaceId: string } {
  const data = object(value);
  if (!herdrId(data['tab_id']) || !herdrId(data['workspace_id'])) throw new InputError('Invalid Herdr tab observation');
  return { tabId: data['tab_id'], workspaceId: data['workspace_id'] };
}
function pane(value: unknown): { paneId: string; tabId: string; workspaceId: string } {
  const data = object(value), association = tab(data);
  if (!herdrId(data['pane_id'])) throw new InputError('Invalid Herdr pane observation');
  return { ...association, paneId: data['pane_id'] };
}
export function validateHerdrTitle(title: string): void {
  if (!title.trim() || title.length > 256 || /[\x00-\x1f\x7f]/.test(title)) throw new InputError('Herdr title must be 1–256 plain characters');
}
function caller(env: Readonly<Record<string, string | undefined>>, run: HerdrRunner) {
  const hints = observeHerdr(env);
  if (!hints) throw new InputError('Explicit Herdr control requires valid managed-pane caller context; ordinary pi works without Herdr');
  const current = pane(result(run(['pane', 'current', '--current']), 'pane_current')['pane']);
  if (current.paneId !== hints.herdrPaneId || current.tabId !== hints.herdrTabId || current.workspaceId !== env['HERDR_WORKSPACE_ID']) {
    throw new InputError('Herdr caller context changed; refresh the caller context rather than targeting the focused pane');
  }
  return { ...hints, ...current };
}
export function controlHerdrSession(command: HerdrControl, env: Readonly<Record<string, string | undefined>>,
  run: HerdrRunner, cards: { show(input: SessionSelection & { instanceKey: string }, context?: WorkContext): SessionShow }, context?: WorkContext) {
  if (command.action === 'title') validateHerdrTitle(command.title);
  const found = cards.show(command, context);
  if (!found.session) throw new InputError('Cannot control session observation: ' + found.issue);
  const card = found.session.card;
  const current = caller(env, run);
  if (card.herdrSocketPath !== current.herdrSocketPath || !herdrId(card.herdrPaneId) || !herdrId(card.herdrTabId)) {
    throw new InputError('Session lacks Herdr target hints on this caller socket; no cross-server or focused-target fallback');
  }
  const target = pane(result(run(['pane', 'current', '--pane', card.herdrPaneId]), 'pane_current')['pane']);
  const targetTab = tab(result(run(['tab', 'get', card.herdrTabId]), 'tab_info')['tab']);
  if (target.paneId !== card.herdrPaneId || target.tabId !== card.herdrTabId
    || targetTab.tabId !== target.tabId || targetTab.workspaceId !== target.workspaceId) {
    throw new InputError('Herdr target association changed; inspect the explicit target');
  }
  try {
    const response = result(command.action === 'focus'
      ? run(['tab', 'focus', target.tabId])
      : run(['tab', 'rename', target.tabId, command.title]), 'tab_info');
    const acknowledged = object(response['tab']);
    const association = tab(acknowledged);
    if (association.tabId !== target.tabId || association.workspaceId !== target.workspaceId
      || (command.action === 'title' && acknowledged['label'] !== command.title)) throw new InputError('Unconfirmed Herdr target');
  } catch { throw new HerdrPartialError(command.action, current.herdrSocketPath, target.tabId, target.paneId); }
  return { status: command.action === 'focus' ? 'focused' as const : 'renamed' as const, instanceKey: command.instanceKey, tabId: target.tabId };
}
const forwarded = ['PATH', 'HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME',
  'PI_CODING_AGENT_DIR', 'MYPI_SESSION_DIR', 'MYPI_SESSION_CARDS', 'MYPI_SESSION_HEARTBEAT_MS',
  'MYPI_MAILBOX_DIR', 'MYPI_MAILBOX_RECEIVE', 'MYPI_MAILBOX_POLL_MS', 'MYPI_GUARD_POLICY'] as const;
function quote(value: string): string {
  if (value.includes('\0')) throw new InputError('NUL cannot be passed to Herdr');
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
/** One command for a POSIX-compatible pane shell; never interpolate native arguments as syntax. */
export function herdrPiCommand(plan: PiLaunchPlan, executable: string, extension: string,
  env: Readonly<Record<string, string | undefined>>): string {
  if (!isAbsolute(executable) || !isAbsolute(extension)) throw new InputError('Herdr launch requires absolute Pi and extension paths');
  const args = ['/usr/bin/env'];
  for (const key of [...forwarded, MYPI_PI_CONTEXT, MYPI_MCP_CONTEXT, MYPI_MCP_NATIVE_SESSION_ID]) args.push('-u', key);
  for (const key of forwarded) if (env[key] !== undefined) args.push(key + '=' + env[key]);
  if (plan.context) args.push(MYPI_PI_CONTEXT + '=' + encodePiContext(plan.context));
  args.push(executable, '--extension', extension, ...plan.args);
  if (!isAbsolute(plan.cwd)) throw new InputError('Herdr launch requires an absolute cwd');
  return 'cd ' + quote(plan.cwd) + ' && ' + args.map(quote).join(' ');
}
export function openHerdrPi(plan: PiLaunchPlan, executable: string, extension: string,
  env: Readonly<Record<string, string | undefined>>, run: HerdrRunner, title?: string): HerdrSubmission {
  if (title !== undefined) validateHerdrTitle(title);
  const command = herdrPiCommand(plan, executable, extension, env);
  const current = caller(env, run);
  let tabId: string | undefined, paneId: string | undefined;
  try {
    const created = result(run(['tab', 'create', '--workspace', current.workspaceId, '--cwd', plan.cwd, '--no-focus',
      ...(title === undefined ? [] : ['--label', title])]), 'tab_created');
    // Retain any individually valid returned handles even if the association is malformed.
    const rawTab = object(created['tab']);
    if (herdrId(rawTab['tab_id'])) tabId = rawTab['tab_id'];
    const rawPane = object(created['root_pane']);
    if (herdrId(rawPane['pane_id'])) paneId = rawPane['pane_id'];
    const createdTab = tab(rawTab), root = pane(rawPane);
    if (createdTab.workspaceId !== current.workspaceId || root.workspaceId !== createdTab.workspaceId
      || root.tabId !== createdTab.tabId) throw new InputError('Unconfirmed Herdr creation');
    tabId = createdTab.tabId; paneId = root.paneId;
  } catch { throw new HerdrPartialError('create', current.herdrSocketPath, tabId, paneId); }
  try {
    // Herdr 0.8.2 send_ok_request waits for the server, then exits 0 without printing JSON.
    const receipt = run(['pane', 'run', paneId, command]);
    if (receipt.code !== 0 || receipt.stdout !== '') throw new InputError('Unexpected Herdr submission receipt');
  }
  catch { throw new HerdrPartialError('submit', current.herdrSocketPath, tabId, paneId); }
  return { status: 'submitted', herdrSocketPath: current.herdrSocketPath, tabId, paneId };
}
