import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppCommand } from './commands.js';
import { createApp, engineRoot } from './create-app.js';
import { deliverToStarted } from './delivery.js';
import type { EventTransports } from './delivery.js';
import { callerMode, decideOpen, defaultAgent, launchArgs, parseOpenKey, PERMISSION_MODES } from './open-session.js';
import { startMessage } from './start-message.js';
import { openTaskWorktree } from './task-worktree.js';
import { noCloneError } from './warmup.js';
import { HerdrError, herdrCli } from '../infrastructure/herdr/herdr.js';
import { startFrame } from '../modules/events/public.js';
import type { Agent } from '../modules/sessions/public.js';
import { PartialError } from '../shared/context.js';
import { InputError } from '../shared/errors.js';

type Of<N extends AppCommand['name']> = Extract<AppCommand, { name: N }>;
type Opened = { key: string; agent: Agent; action: 'focused' | 'resumed' | 'started';
  workspaceId: string | null; tabId: string | null; worktreePath: string | null; notes: string[] };

function readSettings(root: string): string | undefined {
  try { return readFileSync(join(root, 'settings.json'), 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function openSession(filename: string, root: string, c: Of<'open_session'>, transports: EventTransports = {}, proc = '/proc') {
  if (c.keys.length === 0) throw new InputError('Name at least one key');
  if (c.permissionMode !== undefined && !(PERMISSION_MODES as readonly string[]).includes(c.permissionMode)) {
    throw new InputError('--permission-mode must be one of manual, acceptEdits, auto, bypassPermissions, dontAsk, plan');
  }
  const parsed = c.keys.map(parseOpenKey);
  const read = createApp(filename, true);
  const { keys, labels, chosen, mode } = (() => {
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
          if (project.checkoutPath === null) throw noCloneError(project);
          return { key: number === undefined ? project.code : project.code + '-' + number, label: project.org + '/' + project.slug };
        });
        const chosen = c.agent ?? defaultAgent(readSettings(root));
        const mode = c.permissionMode ?? callerMode(read.sessions(c.runtime, proc), c.session) ?? null;
        const labels = new Map<string, string>();
        for (const { key, label } of resolved) if (!labels.has(key)) labels.set(key, label);
        return { keys: [...labels.keys()], labels, chosen, mode };
      });
    } finally { read.close(); }
  })();
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
  const opened: Opened[] = [];
  for (const [i, key] of keys.entries()) {
    try {
      const app = createApp(filename, true);
      const found = (() => { try { return app.sessions(c.runtime, proc).lookup(key); } finally { app.close(); } })();
      const decision = decideOpen(found, chosen);
      const notes: string[] = [];
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
        opened.push({ key, agent: decision.agent, action: 'focused', workspaceId: null, tabId: null, worktreePath: null, notes });
        continue;
      }
      const worktreePath = key.includes('-') ? openTaskWorktree(filename, key).worktreePath : null;
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
      if (decision.action === 'start') {
        if (text !== null) reason = await deliverToStarted(filename, key, [{ id: 0, text }], transports, c.runtime, proc);
        if (reason !== null) notes.push('start message not delivered: ' + reason);
      }
      if (decision.agent === 'pi' && mode !== null) notes.push('Pi has no permission mode; ' + mode + ' was not passed to ' + key);
      opened.push({ key, agent: decision.agent, action: decision.action === 'resume' ? 'resumed' : 'started', workspaceId,
        tabId, worktreePath, notes });
    } catch (error) {
      if (!(error instanceof HerdrError) && !(error instanceof InputError)) throw error;
      if (i > 0) throw new PartialError(key + ': ' + error.message, opened.map(o => o.key), keys.slice(i), []);
      throw new InputError(error instanceof HerdrError ? 'Herdr failed for ' + key + ': ' + error.message : error.message);
    }
  }
  return { opened };
}
