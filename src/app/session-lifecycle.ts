import type { SessionEvent, SessionObservation } from './session-cards.js';
import { InputError } from '../shared/errors.js';

interface Producer { update(event: SessionEvent, observation?: SessionObservation): void }
interface LifecycleOptions {
  start: (observation: SessionObservation) => Producer;
  env: Readonly<Record<string, string | undefined>>;
  schedule: (callback: () => void, milliseconds: number) => () => void;
}

export function sessionHeartbeat(env: Readonly<Record<string, string | undefined>>): number | undefined {
  const enabled = env['MYPI_SESSION_CARDS'];
  if (enabled === '0') return undefined;
  if (enabled !== undefined && enabled !== '1') throw new InputError('Invalid session observation setting');
  const raw = env['MYPI_SESSION_HEARTBEAT_MS'];
  if (raw === undefined) return 30_000;
  if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) < 5000 || Number(raw) > 60000) {
    throw new InputError('Invalid session heartbeat setting');
  }
  return Number(raw);
}
/** Optional observation only: retain plain snapshots, never a native session context. */
export function createSessionLifecycle(options: LifecycleOptions) {
  type Active = { observation: SessionObservation; producer?: Producer; stop?: () => void; notify?: () => void };
  let active: Active | undefined;
  function discard(handle: Active): void {
    if (active === handle) active = undefined;
    handle.stop?.();
    delete handle.stop;
    delete handle.producer;
    delete handle.notify;
  }
  function fail(handle: Active): void {
    const notify = handle.notify;
    discard(handle);
    try { notify?.(); } catch { /* Optional UI must not make cache failure fatal. */ }
  }
  function close(): void {
    const handle = active;
    if (!handle) return;
    try { handle.producer?.update('close'); }
    catch { fail(handle); }
    finally { discard(handle); }
  }
  return {
    start(observation: SessionObservation, initiallyIdle: boolean, notify: () => void): void {
      close();
      const handle: Active = { observation, notify };
      active = handle;
      try {
        const milliseconds = sessionHeartbeat(options.env);
        if (milliseconds === undefined) { discard(handle); return; }
        handle.producer = options.start(observation);
        // A startup sample, not a synthetic native agent_settled event.
        if (initiallyIdle) handle.producer.update('settled', observation);
        handle.stop = options.schedule(() => {
          if (active !== handle) return;
          try { handle.producer?.update('heartbeat', handle.observation); }
          catch { fail(handle); }
        }, milliseconds);
      } catch { fail(handle); }
    },
    update(event: Exclude<SessionEvent, 'close'>, observation: SessionObservation): void {
      const handle = active;
      if (!handle) return;
      if (observation.nativeSessionId !== handle.observation.nativeSessionId) { fail(handle); return; }
      handle.observation = observation;
      try { handle.producer?.update(event, observation); }
      catch { fail(handle); }
    },
    fail(): void { if (active) fail(active); },
    close,
  };
}
