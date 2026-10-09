import type { WorkContext } from '../work-context/public.js';
import { InputError } from '../../shared/errors.js';

export interface SessionCard {
  readonly version: 1;
  readonly instanceKey: string;
  readonly nativeSessionId: string;
  readonly cwd: string;
  readonly context?: WorkContext;
  readonly nativeSessionFile?: string;
  readonly title?: string;
  readonly pid?: number;
  readonly herdrTabId?: string;
  readonly herdrSocketPath?: string;
  readonly herdrPaneId?: string;
  readonly state: 'starting' | 'running' | 'idle' | 'closed';
  readonly startedAt: number;
  readonly lastSeen: number;
}
export type SessionObservation = Omit<SessionCard, 'version' | 'instanceKey' | 'state' | 'startedAt' | 'lastSeen'>;
export type SessionEvent = 'running' | 'settled' | 'heartbeat' | 'close';
export interface SessionView {
  card: SessionCard;
  archived: boolean;
  ageMs: number | null;
  status: SessionCard['state'] | 'stale' | 'unknown';
}
export const SESSION_STALE_MS = 90_000;

function time(at: number): void {
  if (!Number.isSafeInteger(at) || at < 0) throw new InputError('Session observation time must be nonnegative integer milliseconds');
}
export function startSessionCard(instanceKey: string, observation: SessionObservation, at: number): SessionCard {
  time(at);
  return { ...observation, version: 1, instanceKey, state: 'starting', startedAt: at, lastSeen: at };
}
export function updateSessionCard(card: SessionCard, event: SessionEvent, at: number,
  observation: SessionObservation = card): SessionCard {
  if (card.state === 'closed') return card;
  time(at);
  return { ...observation, version: 1, instanceKey: card.instanceKey, startedAt: card.startedAt, lastSeen: at,
    state: event === 'close' ? 'closed' : event === 'running' ? 'running' : event === 'settled' ? 'idle' : card.state };
}
export function sessionView(card: SessionCard, archived: boolean, now: number, staleMs = SESSION_STALE_MS): SessionView {
  if (!Number.isSafeInteger(staleMs) || staleMs < 0) throw new InputError('Invalid session staleness threshold');
  const age = now - card.lastSeen;
  const ageMs = Number.isSafeInteger(now) && now >= 0 && Number.isSafeInteger(age) && age >= 0 ? age : null;
  const status = ageMs === null ? 'unknown' : card.state === 'closed' ? 'closed' : ageMs > staleMs ? 'stale' : card.state;
  return { card, archived, ageMs, status };
}
export function sessionProject(card: SessionCard): string | undefined {
  return card.context?.selectedProject ?? (card.context?.scope.kind === 'project' ? card.context.scope.project : undefined);
}
