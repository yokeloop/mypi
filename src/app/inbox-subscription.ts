import type { EventTransports } from './delivery.js';
import type { SessionRunner } from './session-operations.js';
import type { Agent, DeviceSessions } from '../modules/sessions/public.js';

export type SubscriptionOptions = { server: { url: string; token: string }; pid: number; agent: Agent; runner: SessionRunner;
  device: Pick<DeviceSessions, 'start' | 'records'>; transports: EventTransports;
  fetch: (url: string, init: RequestInit) => Promise<Response>; pause: (ms: number) => Promise<void>; signal: AbortSignal };

export async function subscribeInbox(_o: SubscriptionOptions): Promise<void> {}
