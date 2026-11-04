import { INITIAL_CHANGES, onChange, onDisconnect } from '../lib';

export function subscribeChanges(onRefetch: () => void, onLive: (live: boolean) => void, onClosed: () => void): () => void {
  const source = new EventSource('/v1/changes');
  let state = INITIAL_CHANGES;
  source.addEventListener('change', event => {
    const step = onChange(state, event.data);
    state = step.state;
    if (step.refetch) onRefetch();
  });
  source.addEventListener('open', () => onLive(true));
  source.addEventListener('error', () => {
    state = onDisconnect(state);
    onLive(false);
    if (source.readyState === EventSource.CLOSED) onClosed();
  });
  return () => source.close();
}
