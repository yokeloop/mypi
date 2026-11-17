import { hostname } from 'node:os';
import { createApp } from './create-app.js';
import { appendFact, keyScope, sendParentMessage } from './journal-facts.js';
import { trustedCheckoutPaths } from '../infrastructure/filesystem/paths.js';
import type { EventRow } from '../modules/events/public.js';
import type { Entry } from '../modules/knowledge/public.js';
import { validSlug } from '../modules/projects/public.js';
import type { Project } from '../modules/projects/public.js';
import type { Agent, SessionRow } from '../modules/sessions/public.js';
import type { Card } from '../modules/tasks/public.js';
import { InputError } from '../shared/errors.js';
import type { Page } from '../shared/page.js';

export type OperationTarget = { filename: string; root?: string; trustedPaths?: boolean };
type Identity = { agent: Agent; nativeId: string };
type Keyed = Identity & { key: string };

export type SessionOperations = {
  session_key: { input: Identity; output: { key: string | null } };
  session_save: { input: Identity & { device: string; candidateKey: string | null; fork: boolean; envScope?: string; otherLive: Keyed[]; own: Keyed[] };
    output: { key: string; registered: boolean } };
  session_forget_rows: { input: { key: string }; output: { forgotten: string } };
  session_activate: { input: Identity & { claim: boolean };
    output: { key: string | null; id: number | null; switched: { key: string; agent: Agent; device: string; entries: number; since: string; worktree: string | null } | null; events: EventRow[] } };
  events_claim: { input: { key: string; live: Identity[]; messagesOnly?: boolean };
    output: { sessionId: number | null; agent: Agent | null; nativeId: string | null; events: EventRow[] } };
  events_settle: { input: { sessionId: number; acked: number[]; released: number[] }; output: { status: 'ok' } };
  event_create: { input: { from: string; kind: 'turn_end' | 'waiting'; message: string; to?: string }; output: { event: number | null; to: string | null } };
  inbox_take: { input: { key: string; caller: Identity | null }; output: { events: EventRow[] } };
  message_create: { input: { from: string; to: string; message: string }; output: { id: number } };
  warmup_data: { input: { key: string }; output: WarmupData };
  events_mark: { input: { ids: number[]; caller: Identity | null }; output: { status: 'ok' } };
  open_snapshot: { input: { orgs: string[] }; output: { projects: Project[]; cards: Card[]; rows: SessionRow[]; orgs: string[] } };
  parent_check: { input: { from: string; to: string }; output: { status: 'ok' } };
  session_open: { input: Identity & { key: string; device: string; opened?: { action: 'started' | 'resumed'; worktree: string | null } };
    output: { status: 'ok' } };
  worktree_record: { input: { key: string; worktreePath: string; created?: { branch: string; base: string } }; output: { status: 'ok' } };
  checkout_record: { input: { identity: string; checkoutPath: string; action: 'cloned' | 'initialized' | 'adopted'; repository?: string };
    output: { checkoutPath: string } };
  event_list: { input: { to?: string; from?: string; kind?: 'turn_end' | 'waiting' | 'milestone' | 'message'; delivered?: boolean;
    q?: string; before?: number; limit: number }; output: Page<EventRow> };
};
export type SessionOperationName = keyof SessionOperations;
export type SessionOperationInput<K extends SessionOperationName> = SessionOperations[K]['input'];
export type SessionOperationOutput<K extends SessionOperationName> = SessionOperations[K]['output'];
export type SessionRunner = { remote: boolean; device: string;
  run<K extends SessionOperationName>(name: K, input: SessionOperationInput<K>): Promise<SessionOperationOutput<K>> };
export type WarmupData = { projects: Project[]; cards: Card[]; orgProjects: Project[] | null;
  stats: { count: number; lastAt: string | null } | null; journal: Entry[] | null; fresh: EventRow[]; history: EventRow[] };

type App = ReturnType<typeof createApp>;

function db<T>(t: OperationTarget, readonly: boolean, fn: (app: App) => T): T {
  const app = createApp(t.filename, readonly, undefined, t.trustedPaths ? trustedCheckoutPaths : undefined);
  try { return fn(app); } finally { app.close(); }
}

function known(app: App, slug: string): boolean {
  try { app.projects.list(slug); return true; } catch (e) { if (e instanceof InputError) return false; throw e; }
}

function warmupData(app: App, key: string): WarmupData {
  const projects = app.projects.list(), cards = app.tasks.list();
  const taskKey = (card: Card) => (card.projectId === null ? 'REQ' : projects.find(p => p.id === card.projectId)!.code) + '-' + card.number;
  const data: WarmupData = { projects, cards, orgProjects: null, stats: null, journal: null, fresh: [], history: [] };
  const fresh = () => app.events.pending(key).filter(event => event.kind !== 'message');
  if (/^[A-Z]+$/.test(key)) {
    const project = projects.find(p => p.code === key);
    if (project === undefined) return data;
    return { ...data, stats: app.journalStore.stats(key, cards.filter(card => card.projectId === project.id).map(taskKey)),
      fresh: fresh(), history: app.events.lastDelivered(key) };
  }
  if (key !== 'global' && key !== 'all' && validSlug(key)) return { ...data, orgProjects: app.projects.list(key), fresh: fresh(), history: app.events.lastDelivered(key) };
  if (/^[A-Z]+-[1-9][0-9]*$/.test(key)) return { ...data, journal: app.journalStore.last({ type: 'task', key }, 5) };
  return data;
}

export const sessionOperations = {
  session_key: (t, i) => db(t, true, app => ({ key: app.sessions(undefined).nativeKey(i) })),
  session_save: (t, i) => db(t, false, app => app.sessions(undefined).saveRow(i)),
  session_forget_rows: (t, i) => db(t, false, app => app.sessions(undefined).forgetRows(i.key)),
  session_activate: (t, i) => db(t, false, app => app.serialize(() => {
    const prompted = app.sessions(undefined).prompt({ agent: i.agent, nativeId: i.nativeId });
    if (prompted.id === null) return { key: null, id: null, switched: null, events: [] };
    const key = prompted.key!;
    let switched: SessionOperationOutput<'session_activate'>['switched'] = null;
    if (prompted.previous !== null && prompted.since !== null) {
      try {
        const entries = app.journalStore.countSince(key === 'global' ? { type: 'global' } : keyScope(key), prompted.since);
        const match = /^([A-Z]+)-([1-9][0-9]*)$/.exec(key);
        let worktree: string | null = null;
        if (match) {
          const project = app.projects.list().find(p => p.code === match[1]);
          const card = project && app.tasks.list().find(t => t.projectId === project.id && t.number === Number(match[2]));
          worktree = card?.worktreePath ?? null;
        }
        switched = { key, agent: prompted.previous.agent, device: prompted.previous.device, entries, since: prompted.since, worktree };
      } catch { switched = null; }
    }
    const events = i.claim ? app.events.claim(key, prompted.id, { takeOver: true }) : [];
    return { key, id: prompted.id, switched, events };
  })),
  events_claim: (t, i) => db(t, false, app => app.serialize(() => {
    const row = app.sessions(undefined).activeRow(i.key);
    if (row === undefined || !i.live.some(l => l.agent === row.agent && l.nativeId === row.nativeId)) {
      return { sessionId: null, agent: null, nativeId: null, events: [] };
    }
    const events = app.events.claim(i.key, row.id, i.messagesOnly ? { messagesOnly: true } : {});
    return { sessionId: row.id, agent: row.agent, nativeId: row.nativeId, events };
  })),
  events_settle: (t, i) => {
    if (i.acked.length === 0 && i.released.length === 0) return { status: 'ok' };
    return db(t, false, app => {
      app.serialize(() => { app.events.deliver(i.acked); app.events.release(i.released, i.sessionId); });
      return { status: 'ok' };
    });
  },
  event_create: (t, i) => db(t, false, app => {
    const r = app.events.emit(i);
    return { event: r.event, to: r.to ?? null };
  }),
  inbox_take: (t, i) => db(t, false, app => app.serialize(() => {
    const events = i.key === 'all' ? app.events.pending(null).filter(e => e.kind !== 'message') : app.events.pending(i.key);
    const claimer = i.caller === null ? null : app.sessions(undefined).rowId(i.caller) ?? null;
    app.events.deliver(events.map(e => e.id), claimer);
    return { events };
  })),
  message_create: (t, i) => db(t, false, app => ({ id: sendParentMessage(app, i) })),
  warmup_data: (t, i) => db(t, true, app => app.readSnapshot(() => warmupData(app, i.key))),
  events_mark: (t, i) => {
    if (i.ids.length === 0) return { status: 'ok' };
    return db(t, false, app => {
      app.serialize(() => app.events.deliver(i.ids, i.caller === null ? null : app.sessions(undefined).rowId(i.caller) ?? null));
      return { status: 'ok' };
    });
  },
  open_snapshot: (t, i) => db(t, true, app => app.readSnapshot(() => ({ projects: app.projects.list(), cards: app.tasks.list(),
    rows: app.sessions(undefined).rows(), orgs: i.orgs.filter(slug => known(app, slug)) }))),
  parent_check: (t, i) => db(t, true, app => { app.events.assertParent(i.from, i.to); return { status: 'ok' }; }),
  session_open: (t, i) => db(t, false, app => app.serialize(() => {
    app.sessions(undefined).activate({ key: i.key, agent: i.agent, nativeId: i.nativeId, device: i.device });
    if (i.opened) appendFact(app, keyScope(i.key), 'session_opened', (i.opened.action === 'resumed' ? 'resumed ' : 'started ') + i.agent
      + (i.opened.worktree === null ? '' : ', worktree ' + i.opened.worktree));
    return { status: 'ok' };
  })),
  worktree_record: (t, i) => db(t, false, app => app.serialize(() => {
    const match = /^([A-Z]+)-([1-9][0-9]*)$/.exec(i.key);
    if (!match) throw new InputError('Invalid task key: ' + i.key + '; use CODE-N (MP-12)');
    const project = app.projects.list().find(p => p.code === match[1]);
    const card = project && app.tasks.list().find(c => c.projectId === project.id && c.number === Number(match[2]));
    if (!project || !card) throw new InputError('Unknown task: ' + i.key);
    app.tasks.recordWorktree(card.id, i.worktreePath);
    if (i.created) appendFact(app, { type: 'task', key: i.key }, 'worktree_created',
      'worktree ' + i.worktreePath + ', branch ' + i.created.branch + ', base ' + i.created.base);
    return { status: 'ok' };
  })),
  checkout_record: (t, i) => db(t, false, app => app.serialize(() => {
    const result = app.projects.updateCheckout(i.identity, null, i.checkoutPath);
    appendFact(app, { type: 'project', key: result.code }, 'clone_prepared', 'clone prepared: ' + i.action + ' ' + result.checkoutPath!
      + (i.action === 'cloned' ? ' from ' + i.repository : ''));
    return { checkoutPath: result.checkoutPath! };
  })),
  event_list: (t, i) => db(t, true, app => app.readSnapshot(() => app.events.browse(i))),
} satisfies { [K in SessionOperationName]: (t: OperationTarget, i: SessionOperationInput<K>) => SessionOperationOutput<K> };

export function runSessionOperation<K extends SessionOperationName>(t: OperationTarget, name: K, input: SessionOperationInput<K>): SessionOperationOutput<K> {
  return (sessionOperations[name] as (t: OperationTarget, i: SessionOperationInput<K>) => SessionOperationOutput<K>)(t, input);
}

export function localSessionRunner(filename: string): SessionRunner {
  return { remote: false, device: hostname(), run: async (name, input) => runSessionOperation({ filename }, name, input) };
}
