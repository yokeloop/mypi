import type { SessionList } from './session-cards.js';

/** Stored cwd text is an advisory path hint, not realpath identity or writer ownership. */
export function cleanupCardHints(worktreeRoot: string, observations: SessionList) {
  return {
    hints: observations.sessions.filter(({ card }) => card.cwd === worktreeRoot || card.cwd.startsWith(worktreeRoot + '/'))
      .map(({ card, status, archived, ageMs }) => ({ instanceKey: card.instanceKey, cwd: card.cwd, status, archived, ageMs })),
    issues: observations.issues.map(({ issue }) => ({ issue })),
    truncated: observations.truncated,
  };
}

export interface CleanupPublication {
  state: 'not-observed' | 'matches-head' | 'different-head' | 'missing-ref' | 'unavailable';
  remote?: string;
  ref: string;
  remoteHead?: string | null;
}
