import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppCommand, RunContext } from './commands.js';
import { deviceSessions, engineRoot } from './create-app.js';
import { deliverOnOpen, deliverPending } from './delivery.js';
import type { EventTransports } from './delivery.js';
import { agentName, callerMode, decideOpen, defaultAgent, heldNames, herdrName, launchArgs, openTarget, otherDevicesNote, parseOpenKey, PERMISSION_MODES } from './open-session.js';
import type { OpenRequest } from './open-session.js';
import { callerKey } from './sessions.js';
import type { SessionRunner } from './session-operations.js';
import { startText } from './start-message.js';
import { prepareCheckouts } from './project-checkout.js';
import { openTaskWorktree } from './task-worktree.js';
import { HerdrError, herdrCli } from '../infrastructure/herdr/herdr.js';
import { startFrame } from '../modules/events/public.js';
import { noRepositoryError } from '../modules/projects/public.js';
import type { Project } from '../modules/projects/public.js';
import type { Agent } from '../modules/sessions/public.js';
import { PartialError } from '../shared/context.js';
import { InputError } from '../shared/errors.js';

type Of<N extends AppCommand['name']> = Extract<AppCommand, { name: N }>;
type Opened = { key: string; agent: Agent; action: 'focused' | 'resumed' | 'started';
  workspaceId: string | null; tabId: string | null; worktreePath: string | null; notes: string[]; message: number | null };

function readSettings(root: string): string | undefined {
  try { return readFileSync(join(root, 'settings.json'), 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function openSession(runner: SessionRunner, root: string, c: Of<'open_session'>, transports: EventTransports = {}, proc = '/proc',
  projectsRoot = join(engineRoot(), 'projects'), context: RunContext = {}) {
  if (c.keys.length === 0) throw new InputError('Name at least one key');
  if (c.permissionMode !== undefined && !(PERMISSION_MODES as readonly string[]).includes(c.permissionMode)) {
    throw new InputError('--permission-mode must be one of manual, acceptEdits, auto, bypassPermissions, dontAsk, plan');
  }
  const parsed = c.keys.map(parseOpenKey);
  const device = deviceSessions(c.runtime, proc);
  const { projects, cards, rows, orgs } = await runner.run('open_snapshot', { orgs: [...new Set(parsed.filter(k => k.kind === 'org').map(k => k.slug))] });
  const resolved = parsed.map(key => {
    if (key.kind === 'org') {
      if (!orgs.includes(key.slug)) throw new InputError('Unknown organization');
      if (projects.filter(p => p.org === key.slug).length === 0) {
        throw new InputError('Organization ' + key.slug + ' has no registered projects; /open ' + key.slug + ' opens organizations with at least one');
      }
      return { key: key.slug, label: key.slug, kind: 'org' as const, code: null, project: null };
    }
    const project = key.kind === 'identity' ? projects.find(p => p.org === key.org && p.slug === key.slug)
      : projects.find(p => p.code === key.code);
    if (!project) throw new InputError('Unknown project: ' + (key.kind === 'identity' ? key.org + '/' + key.slug : key.code));
    const number = key.kind === 'project' ? undefined : key.number;
    if (number !== undefined && !cards.some(card => card.projectId === project.id && card.number === number)) {
      throw new InputError('Unknown task: ' + project.code + '-' + number);
    }
    if (project.checkoutPath === null && project.repository === null) throw noRepositoryError(project);
    return { key: number === undefined ? project.code : project.code + '-' + number, label: project.org + '/' + project.slug,
      kind: number === undefined ? 'project' as const : 'task' as const, code: project.code, project };
  });
  if (c.new && c.target !== undefined) throw new InputError('--new and --session cannot be used together');
  if (c.target !== undefined) {
    if (new Set(resolved.map(r => r.key)).size !== 1) throw new InputError('--session takes exactly one key');
    openTarget(rows.filter(r => r.key === resolved[0]!.key), resolved[0]!.key, runner.device, c.target, c.agent);
  }
  const chosen = c.agent ?? defaultAgent(readSettings(root));
  const mode = c.permissionMode ?? callerMode({ liveRecords: () => device.records() }, c.session) ?? null;
  const entries = new Map<string, typeof resolved[number]>();
  for (const entry of resolved) if (!entries.has(entry.key)) entries.set(entry.key, entry);
  const missing: Project[] = resolved.map(r => r.project).filter((p): p is Project => p !== null && p.checkoutPath === null);
  const keys = [...entries.keys()];
  const request: OpenRequest = { chosen, ...(c.agent === undefined ? {} : { agent: c.agent }), ...(c.new ? { new: true } : {}),
    ...(c.target === undefined ? {} : { target: c.target }) };
  let caller: string | undefined;
  if (c.message !== undefined) {
    if (keys.length !== 1) throw new InputError('--message takes exactly one key');
    caller = await callerKey(runner, c);
    if (caller === undefined) throw new InputError('The calling session key could not be resolved');
    await runner.run('parent_check', { from: caller, to: keys[0]! });
    if (c.message.trim() === '') throw new InputError('Message text is empty');
  }
  const enqueue = async (key: string): Promise<number | null> => {
    if (c.message === undefined) return null;
    return (await runner.run('message_create', { from: caller!, to: key, message: c.message })).id;
  };
  const herdr = herdrCli();
  const cwd = engineRoot().replace(/\/$/, '');
  const byLabel = new Map<string, string>();
  try {
    for (const w of herdr.workspaces()) if (!byLabel.has(w.label)) byLabel.set(w.label, w.workspaceId);
  } catch (error) {
    if (!(error instanceof HerdrError)) throw error;
    if (error.code === 'unavailable') throw new InputError('Herdr is not available (' + error.message + '); /open needs a running Herdr server. Nothing was opened.');
    throw new InputError('Herdr failed: ' + error.message + '. Nothing was opened.');
  }
  const prepared = new Map((await prepareCheckouts(runner, missing, projectsRoot, context)).map(p => [p.code,
    'clone prepared: ' + p.action + ' ' + p.checkoutPath + (p.action === 'cloned' ? ' from ' + missing.find(m => m.code === p.code)!.repository : '')]));
  const opened: Opened[] = [];
  for (const [i, key] of keys.entries()) {
    try {
      const all = device.records();
      const found = { rows: rows.filter(r => r.key === key), records: all.filter(r => r.key === key) };
      const decision = decideOpen(found, key, runner.device, request);
      const notes: string[] = [];
      const entry = entries.get(key)!;
      const note = entry.code === null ? undefined : prepared.get(entry.code);
      if (note !== undefined) notes.push(note);
      const elsewhere = otherDevicesNote(found.rows, key, runner.device, request);
      if (elsewhere !== null) notes.push(elsewhere);
      if (decision.action === 'focus') {
        const name = decision.live.herdrName ?? agentName(key, entry.kind);
        try { herdr.focusAgent(name); } catch (error) {
          if (!(error instanceof HerdrError)) throw error;
          throw new InputError(key + ' is live (' + decision.agent + ', pid ' + decision.live.pid + ') but Herdr cannot focus agent ' + name + ': '
            + error.message + '. It was not started by /open in this Herdr server or its agent was renamed; no new tab was created.');
        }
        await runner.run('session_open', { key, agent: decision.live.agent, nativeId: decision.live.nativeId, device: runner.device });
        const message = await enqueue(key);
        if (message !== null) {
          const acked = await deliverPending(runner, key, c.runtime, transports, proc);
          if (!acked.includes(message)) notes.push('message ' + message + ' queued: the live session did not take it');
        }
        opened.push({ key, agent: decision.agent, action: 'focused', workspaceId: null, tabId: null, worktreePath: null, notes, message });
        continue;
      }
      const worktreePath = entry.kind === 'task' ? (await openTaskWorktree(runner, root, key)).worktreePath : null;
      let text: string | null = null, reason: string | null = null;
      if (decision.action === 'start') {
        try { text = startFrame(key, startText(projects, cards, key)); } catch (error) { reason = (error as Error).message; }
      }
      const name = herdrName(agentName(key, entry.kind), decision.agent, heldNames(all));
      const label = entry.label;
      const env = { MYPI_SCOPE: key, MYPI_HERDR_NAME: name, ...(c.stateHome === undefined ? {} : { XDG_STATE_HOME: c.stateHome }),
        ...(c.configHome === undefined ? {} : { XDG_CONFIG_HOME: c.configHome }) };
      const existing = byLabel.get(label);
      let workspaceId: string, tabId: string, paneId: string;
      if (existing !== undefined) {
        const tab = herdr.createTab({ workspaceId: existing, cwd, label: name, env });
        workspaceId = existing;
        tabId = tab.tabId;
        paneId = tab.paneId;
      } else {
        const created = herdr.createWorkspace({ cwd, label, env });
        byLabel.set(label, created.workspaceId);
        herdr.renameTab(created.tabId, name);
        workspaceId = created.workspaceId;
        tabId = created.tabId;
        paneId = created.paneId;
      }
      const uuid = randomUUID();
      herdr.startAgent(name, decision.agent, paneId, launchArgs(decision, key, decision.agent === 'pi' ? null : mode, uuid));
      const session = { agent: decision.agent, nativeId: decision.action === 'start' ? uuid : decision.nativeId };
      await runner.run('session_open', { key, ...session, device: runner.device,
        opened: { action: decision.action === 'resume' ? 'resumed' : 'started', worktree: worktreePath } });
      const message = await enqueue(key);
      const { rows: queued, failure } = await deliverOnOpen(runner, key, session, text, transports, c.runtime, proc);
      if (decision.action === 'start') {
        if (failure !== null && text !== null) reason = failure;
        if (reason !== null) notes.push('start message not delivered: ' + reason);
      }
      if (failure !== null && queued.length > 0) notes.push('messages ' + queued.join(', ') + ' stay queued: ' + failure);
      if (decision.agent === 'pi' && mode !== null) notes.push('Pi has no permission mode; ' + mode + ' was not passed to ' + key);
      opened.push({ key, agent: decision.agent, action: decision.action === 'resume' ? 'resumed' : 'started', workspaceId,
        tabId, worktreePath, notes, message });
    } catch (error) {
      if (!(error instanceof HerdrError) && !(error instanceof InputError)) throw error;
      if (i > 0) throw new PartialError(key + ': ' + error.message, opened.map(o => o.key), keys.slice(i), []);
      throw new InputError(error instanceof HerdrError ? 'Herdr failed for ' + key + ': ' + error.message : error.message);
    }
  }
  return { opened };
}
