import { localEndpoint, type NativeAgent } from './native-herdr-facts.js';
import type { WorkChat } from '../modules/work-chats/public.js';

export interface OwnershipRoute { current: string; origin: string; previousBootEnded: boolean }
export type AgentObservation = { agents: NativeAgent[] } | { error: string };
export type ProcessAbsence = { status: 'dead' | 'unknown'; reason?: string };
export type OwnershipDecision = ProcessAbsence | { status: 'candidate'; agent: NativeAgent; endpoint: string };

/** Socket paths are locators. A different current endpoint cannot erase a same-boot origin. */
export function ownershipRoute(chat: WorkChat, currentEndpoint: unknown, boot: string): OwnershipRoute {
  const current = localEndpoint(currentEndpoint);
  const previousBootEnded = Boolean(chat.processBootId && chat.processBootId !== boot);
  return { current, origin: previousBootEnded ? current : localEndpoint(chat.herdrEndpoint ?? current), previousBootEnded };
}

/** Pure server/association decision. A candidate still needs native history and actual
 * process/resource verification; an empty list alone never establishes process death. */
export function nativeOwnership(chat: WorkChat, route: OwnershipRoute,
  observations: ReadonlyMap<string, AgentObservation>, process: ProcessAbsence): OwnershipDecision {
  const origin = observations.get(route.origin), current = observations.get(route.current);
  if (!origin || 'error' in origin) return { status: 'unknown',
    reason: `Originating Herdr unavailable at ${route.origin}: ${origin && 'error' in origin ? origin.error : 'not observed'}` };
  if (!current || 'error' in current) return { status: 'unknown',
    reason: `Current Herdr unavailable at ${route.current}: ${current && 'error' in current ? current.error : 'not observed'}` };
  const related = (agent: NativeAgent) => agent.cwd === chat.worktree || Boolean(chat.historyPath && agent.sessionPath === chat.historyPath);
  if (route.origin !== route.current && current.agents.some(related)) {
    return { status: 'unknown', reason: 'Conflicting writer at current Herdr endpoint' };
  }
  const matches = origin.agents.filter(related);
  if (matches.length > 1) return { status: 'unknown', reason: 'Multiple agents occupy the associated worktree/session' };
  if (matches.length === 1) {
    const agent = matches[0]!;
    if (agent.kind !== 'pi' || agent.cwd !== chat.worktree || !agent.sessionPath
      || chat.historyPath && agent.sessionPath !== chat.historyPath) {
      return { status: 'unknown', reason: 'Native agent type/cwd/session changed or metadata unavailable' };
    }
    return { status: 'candidate', agent, endpoint: route.origin };
  }
  if (route.previousBootEnded) return { status: 'dead', reason: 'Recorded boot ended; current server has no associated writer' };
  if (!chat.processId || !chat.processStart) return { status: 'unknown', reason: 'Incomplete launch has no correlated native/process identity' };
  return process;
}
