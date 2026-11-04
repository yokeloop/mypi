export type ChangeState = { last: number | null; stale: boolean };

export const INITIAL_CHANGES: ChangeState = { last: null, stale: false };

export function onChange(state: ChangeState, data: string): { state: ChangeState; refetch: boolean } {
  let changeId: unknown;
  try {
    changeId = (JSON.parse(data) as { changeId?: unknown } | null)?.changeId;
  } catch {
    return { state, refetch: false };
  }
  if (typeof changeId !== 'number' || !Number.isInteger(changeId)) return { state, refetch: false };
  return { state: { last: changeId, stale: false }, refetch: state.stale || (state.last !== null && changeId !== state.last) };
}

export function onDisconnect(state: ChangeState): ChangeState {
  return { ...state, stale: true };
}
