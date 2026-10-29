export type EventKind = 'turn_end' | 'waiting';
export interface EventRow { id: number; fromKey: string; toKey: string; kind: EventKind; message: string; createdAt: string; deliveredAt: string | null }
export interface EventStore {
  transaction<T>(fn: () => T): T;
  add(row: Omit<EventRow, 'id' | 'deliveredAt'>): number;
  pending(toKey: string | null): EventRow[];
  lastDelivered(toKey: string): EventRow[];
  deliver(ids: number[], at: string): void;
}
export type EventTransport = (socket: string, events: { id: number; text: string }[]) => Promise<number[]>;
