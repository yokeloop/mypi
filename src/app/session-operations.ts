import { hostname } from 'node:os';
import type { EventRow } from '../modules/events/public.js';
import type { Entry } from '../modules/knowledge/public.js';
import type { Project } from '../modules/projects/public.js';
import type { Agent } from '../modules/sessions/public.js';
import type { Card } from '../modules/tasks/public.js';

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
};
export type SessionOperationName = keyof SessionOperations;
export type SessionOperationInput<K extends SessionOperationName> = SessionOperations[K]['input'];
export type SessionOperationOutput<K extends SessionOperationName> = SessionOperations[K]['output'];
export type SessionRunner = { remote: boolean; device: string;
  run<K extends SessionOperationName>(name: K, input: SessionOperationInput<K>): Promise<SessionOperationOutput<K>> };
export type WarmupData = { projects: Project[]; cards: Card[]; orgProjects: Project[] | null;
  stats: { count: number; lastAt: string | null } | null; journal: Entry[] | null; fresh: EventRow[]; history: EventRow[] };

export function runSessionOperation<K extends SessionOperationName>(_t: OperationTarget, name: K, _input: SessionOperationInput<K>): SessionOperationOutput<K> {
  throw new Error('Not implemented: ' + name);
}

export function localSessionRunner(filename: string): SessionRunner {
  return { remote: false, device: hostname(), run: async (name, input) => runSessionOperation({ filename }, name, input) };
}
