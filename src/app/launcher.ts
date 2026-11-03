import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppCommand } from './commands.js';
import { createApp, engineRoot } from './create-app.js';
import { deliverOnOpen, deliverPending } from './delivery.js';
import type { EventTransports } from './delivery.js';
import { callerMode, decideOpen, defaultAgent, launchArgs, parseOpenKey, PERMISSION_MODES } from './open-session.js';
import { callerKey } from './sessions.js';
import { startMessage } from './start-message.js';
import { prepareCheckouts } from './project-checkout.js';
import { openTaskWorktree } from './task-worktree.js';
import { HerdrError, herdrCli } from '../infrastructure/herdr/herdr.js';
import { assertParent, startFrame } from '../modules/events/public.js';
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

export async function openSession(filename: string, root: string, c: Of<'open_session'>, transports: EventTransports = {}, proc = '/proc',
  projectsRoot = join(engineRoot(), 'projects')) {
  if (c.keys.length === 0) throw new InputError('Name at least one key');
  if (c.permissionMode !== undefined && !(PERMISSION_MODES as readonly string[]).includes(c.permissionMode)) {
    throw new InputError('--permission-mode must be one of manual, acceptEdits, auto, bypassPermissions, dontAsk, plan');
  }
  const parsed = c.keys.map(parseOpenKey);
  const read = createApp(filename, true);
  const { keys, labels, chosen, mode, missing } = (() => {
    try {
      return read.readSnapshot(() => {
        const projects = read.projects.list(), cards = read.tasks.list();
        const resolved = parsed.map(key => {
          const project = key.kind === 'identity' ? projects.find(p => p.org === key.org && p.slug === key.slug)
            : projects.find(p => p.code === key.code);
          if (!project) throw new InputError('Unknown project: ' + (key.kind === 'identity' ? key.org + '/' + key.slug : key.code));
          const number = key.kind === 'project' ? undefined : key.number;
          if (number !== undefined && !cards.some(card => card.projectId === project.id && card.number === number)) {
            throw new InputError('Unknown task: ' + project.code + '-' + number);
          }
          if (project.checkoutPath === null && project.repository === null) throw noRepositoryError(project);
          return { key: number === undefined ? project.code : project.code + '-' + number, label: project.org + '/' + project.slug, project };
        });
        const chosen = c.agent ?? defaultAgent(readSettings(root));
        const mode = c.permissionMode ?? callerMode(read.sessions(c.runtime, proc), c.session) ?? null;
        const labels = new Map<string, string>();
        for (const { key, label } of resolved) if (!labels.has(key)) labels.set(key, label);
        const missing: Project[] = resolved.map(r => r.project).filter(p => p.checkoutPath === null);
        return { keys: [...labels.keys()], labels, chosen, mode, missing };
      });
    } finally { read.close(); }
  })();
  let caller: string | undefined;
  if (c.message !== undefined) {
    if (keys.length !== 1) throw new InputError('--message takes exactly one key');
    caller = callerKey(filename, c);
    if (caller === undefined) throw new InputError('The calling session key could not be resolved');
    assertParent(caller, keys[0]!);
    if (c.message.trim() === '') throw new InputError('Message text is empty');
  }
  const enqueue = (key: string): number | null => {
    if (c.message === undefined) return null;
    const app = createApp(filename, false);
    try { return app.events.send({ from: caller!, to: key, message: c.message }); } finally { app.close(); }
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
  const prepared = new Map((await prepareCheckouts(filename, missing, projectsRoot)).map(p => [p.code,
    'clone prepared: ' + p.action + ' ' + p.checkoutPath + (p.action === 'cloned' ? ' from ' + missing.find(m => m.code === p.code)!.repository : '')]));
  const opened: Opened[] = [];
  for (const [i, key] of keys.entries()) {
    try {
      const app = createApp(filename, true);
      const found = (() => { try { return app.sessions(c.runtime, proc).lookup(key); } finally { app.close(); } })();
      const decision = decideOpen(found, chosen);
      const notes: string[] = [];
      const note = prepared.get(key.split('-')[0]!);
      if (note !== undefined) notes.push(note);
      const name = key.toLowerCase();
      if (c.agent !== undefined && c.agent !== decision.agent) {
        notes.push(key + ' continues with its agent ' + decision.agent + '; --agent ' + c.agent + ' applies only to new sessions');
      }
      if (decision.action === 'focus') {
        try { herdr.focusAgent(name); } catch (error) {
          if (!(error instanceof HerdrError)) throw error;
          throw new InputError(key + ' is live (' + decision.agent + ', pid ' + decision.live.pid + ') but Herdr cannot focus agent ' + name + ': '
            + error.message + '. It was not started by /open in this Herdr server or its agent was renamed; no new tab was created.');
        }
        const message = enqueue(key);
        if (message !== null) {
          const app = createApp(filename, false);
          const acked = await (async () => { try { return await deliverPending(app, key, c.runtime, transports, proc); } finally { app.close(); } })();
          if (!acked.includes(message)) notes.push('message ' + message + ' queued: the live session did not take it');
        }
        opened.push({ key, agent: decision.agent, action: 'focused', workspaceId: null, tabId: null, worktreePath: null, notes, message });
        continue;
      }
      const worktreePath = key.includes('-') ? openTaskWorktree(filename, root, key).worktreePath : null;
      let text: string | null = null, reason: string | null = null;
      if (decision.action === 'start') {
        try { text = startFrame(key, startMessage(filename, key, worktreePath)); } catch (error) { reason = (error as Error).message; }
      }
      const label = labels.get(key)!;
      const env = { MYPI_SCOPE: key, ...(c.stateHome === undefined ? {} : { XDG_STATE_HOME: c.stateHome }) };
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
      herdr.startAgent(name, decision.agent, paneId, launchArgs(decision, key, decision.agent === 'pi' ? null : mode, randomUUID()));
      const message = enqueue(key);
      const { rows, failure } = await deliverOnOpen(filename, key, text, transports, c.runtime, proc);
      if (decision.action === 'start') {
        if (failure !== null && text !== null) reason = failure;
        if (reason !== null) notes.push('start message not delivered: ' + reason);
      }
      if (failure !== null && rows.length > 0) notes.push('messages ' + rows.join(', ') + ' stay queued: ' + failure);
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
