import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { externalStatePath } from '../infrastructure/filesystem/paths.js';
import { InvalidSessionCache, sessionCardFiles, validateSessionKey } from '../infrastructure/filesystem/session-cards.js';
import { sessionProject, sessionView, startSessionCard, updateSessionCard } from '../modules/session-cards/public.js';
import type { SessionCard, SessionEvent, SessionObservation, SessionView } from '../modules/session-cards/public.js';
import type { WorkContext } from '../modules/work-context/public.js';
import { InputError } from '../shared/errors.js';
import { parsePiContext } from './pi-context.js';

export type { SessionCard, SessionEvent, SessionObservation, SessionView } from '../modules/session-cards/public.js';
export interface SessionSelection { project?: string; all?: boolean }
export type SessionCommand =
  | ({ name: 'session_list'; includeArchived?: boolean } & SessionSelection)
  | ({ name: 'session_show' | 'session_archive'; instanceKey: string } & SessionSelection);
export interface SessionIssue { instanceKey?: string; issue: 'invalid' | 'unavailable' | 'missing' }
export interface SessionList { sessions: SessionView[]; issues: SessionIssue[]; truncated: boolean }
type SessionRead = { session: SessionView } | { session: null; issue: SessionIssue['issue'] };
export type SessionShow = SessionRead | { session: null; issue: 'outside-selection' };
export interface SessionArchive { instanceKey: string; archived: true }
const engineRoot = fileURLToPath(new URL('../../../', import.meta.url));
const defaultContextRoot = join(engineRoot, 'home');
const projectPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function resolveSessionDirectory(env: Readonly<Record<string, string | undefined>>, home: string,
  contextRoot = defaultContextRoot): string {
  const state = env['XDG_STATE_HOME'] || join(home, '.local', 'state');
  if (env['MYPI_SESSION_DIR'] === undefined && !isAbsolute(state)) throw new InputError('XDG_STATE_HOME must be absolute');
  const input = env['MYPI_SESSION_DIR'] ?? join(state, 'mypi', 'sessions');
  return externalStatePath(externalStatePath(input, engineRoot, 'Session cache'), contextRoot, 'Session cache');
}
function mapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function plain(value: unknown, empty = false): value is string {
  return typeof value === 'string' && (empty || value.length > 0) && !/[\x00-\x1f\x7f]/.test(value);
}
function path(value: unknown): value is string {
  return plain(value) && isAbsolute(value) && normalize(value) === value;
}
function epoch(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }

/** Stored context is validated, never inferred from a former or foreign selection. */
export function parseSessionCard(value: unknown, instanceKey: string): SessionCard | undefined {
  if (!mapping(value) || Object.keys(value).some(key => !['version', 'instanceKey', 'nativeSessionId', 'cwd', 'context',
    'nativeSessionFile', 'title', 'pid', 'herdrTabId', 'state', 'startedAt', 'lastSeen'].includes(key))) return;
  try { validateSessionKey(instanceKey); } catch { return; }
  if (value['version'] !== 1 || value['instanceKey'] !== instanceKey || !plain(value['nativeSessionId']) || !path(value['cwd'])
    || !epoch(value['startedAt']) || !epoch(value['lastSeen'])
    || typeof value['state'] !== 'string' || !['starting', 'running', 'idle', 'closed'].includes(value['state'])) return;
  if ('nativeSessionFile' in value && !path(value['nativeSessionFile'])) return;
  if ('title' in value && !plain(value['title'], true)) return;
  if ('herdrTabId' in value && !plain(value['herdrTabId'])) return;
  if ('pid' in value && (!epoch(value['pid']) || value['pid'] === 0)) return;
  const context = 'context' in value ? parsePiContext({ version: 1, cwd: value['cwd'], context: value['context'] }) : undefined;
  if ('context' in value && !context) return;
  return { version: 1, instanceKey, nativeSessionId: value['nativeSessionId'], cwd: value['cwd'],
    state: value['state'] as SessionCard['state'], startedAt: value['startedAt'], lastSeen: value['lastSeen'],
    ...(context ? { context: context.context } : {}),
    ...(typeof value['nativeSessionFile'] === 'string' ? { nativeSessionFile: value['nativeSessionFile'] } : {}),
    ...(typeof value['title'] === 'string' ? { title: value['title'] } : {}),
    ...(typeof value['pid'] === 'number' ? { pid: value['pid'] } : {}),
    ...(typeof value['herdrTabId'] === 'string' ? { herdrTabId: value['herdrTabId'] } : {}),
  };
}
function selection(input: SessionSelection, context?: WorkContext): string | undefined {
  if (input.all !== undefined && typeof input.all !== 'boolean') throw new InputError('Session all must be boolean');
  if (input.all && input.project !== undefined) throw new InputError('Use project or all, not both');
  if (input.all) return undefined;
  const project = input.project ?? context?.selectedProject ?? (context?.scope.kind === 'project' ? context.scope.project : undefined);
  if (project === undefined) throw new InputError('Select a concrete project or use explicit project/all for session observations');
  if (!projectPattern.test(project)) throw new InputError('Session project must use org/project identity');
  return project;
}
function issue(error: unknown): 'invalid' | 'unavailable' { return error instanceof InvalidSessionCache ? 'invalid' : 'unavailable'; }

export interface SessionCardsOptions {
  env?: Readonly<Record<string, string | undefined>>;
  home?: string;
  contextRoot?: string;
  clock?: () => number;
  staleMs?: number;
}
export function createSessionCards(options: SessionCardsOptions = {}) {
  const directory = resolveSessionDirectory(options.env ?? process.env, options.home ?? homedir(), options.contextRoot);
  const files = sessionCardFiles(directory), clock = options.clock ?? Date.now;
  function observe(instanceKey: string, now: number): SessionRead {
    try {
      const raw = files.read(instanceKey);
      if (raw === undefined) return { session: null, issue: 'missing' };
      const card = parseSessionCard(raw, instanceKey);
      if (!card) return { session: null, issue: 'invalid' };
      return { session: sessionView(card, files.archived(instanceKey), now, options.staleMs) };
    } catch (error) { return { session: null, issue: issue(error) }; }
  }
  function show(input: SessionSelection & { instanceKey: string }, context?: WorkContext): SessionShow {
    const project = selection(input, context);
    validateSessionKey(input.instanceKey);
    const result = observe(input.instanceKey, clock());
    if (result.session && project !== undefined && sessionProject(result.session.card) !== project) {
      return { session: null, issue: 'outside-selection' };
    }
    return result;
  }
  return {
    directory,
    list(input: SessionSelection & { includeArchived?: boolean }, context?: WorkContext): SessionList {
      const project = selection(input, context), now = clock();
      if (input.includeArchived !== undefined && typeof input.includeArchived !== 'boolean') throw new InputError('includeArchived must be boolean');
      const result: SessionList = { sessions: [], issues: [], truncated: false };
      let scan: ReturnType<typeof files.scan>;
      try { scan = files.scan(); }
      catch (error) { return { ...result, issues: [{ issue: issue(error) }] }; }
      result.truncated = scan.truncated;
      for (let i = 0; i < scan.invalid; i++) result.issues.push({ issue: 'invalid' });
      for (const instanceKey of scan.keys) {
        const found = observe(instanceKey, now);
        if (!found.session) { result.issues.push({ instanceKey, issue: found.issue }); continue; }
        if ((!found.session.archived || input.includeArchived) && (project === undefined || sessionProject(found.session.card) === project)) {
          result.sessions.push(found.session);
        }
      }
      result.sessions.sort((a, b) => b.card.lastSeen - a.card.lastSeen || a.card.instanceKey.localeCompare(b.card.instanceKey));
      return result;
    },
    show,
    archive(input: SessionSelection & { instanceKey: string }, context?: WorkContext): SessionArchive {
      const found = show(input, context);
      if (!found.session) throw new InputError('Cannot archive session observation: ' + found.issue);
      try { files.archive(input.instanceKey); }
      catch (error) { throw new InputError('Cannot archive session observation: ' + issue(error)); }
      return { instanceKey: input.instanceKey, archived: true };
    },
    start(observation: SessionObservation) {
      const instanceKey = randomUUID();
      function checked(candidate: SessionCard): SessionCard {
        const parsed = parseSessionCard(candidate, instanceKey);
        if (!parsed) throw new InputError('Invalid session observation');
        return parsed;
      }
      let card = checked(startSessionCard(instanceKey, observation, clock()));
      files.write(instanceKey, card);
      return {
        get instanceKey() { return instanceKey; },
        update(event: SessionEvent, observation?: SessionObservation): void {
          if (card.state === 'closed') return;
          const next = checked(updateSessionCard(card, event, clock(), observation));
          // Close locally even if the final best-effort cache write fails.
          card = next;
          files.write(instanceKey, card);
        },
      };
    },
  };
}

export function executeSessionCommand(command: SessionCommand, context?: WorkContext, options?: SessionCardsOptions): SessionList | SessionShow | SessionArchive {
  const cards = createSessionCards(options);
  switch (command.name) {
    case 'session_list': return cards.list(command, context);
    case 'session_show': return cards.show(command, context);
    case 'session_archive': return cards.archive(command, context);
  }
}
