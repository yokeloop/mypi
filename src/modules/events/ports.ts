export type EventKind = 'turn_end' | 'waiting' | 'milestone' | 'message';
export interface EventRow { id: number; fromKey: string; toKey: string; kind: EventKind; message: string; createdAt: string; deliveredAt: string | null }
export interface EventStore {
  transaction<T>(fn: () => T): T;
  add(row: Omit<EventRow, 'id' | 'deliveredAt'>): number;
  pending(toKey: string | null): EventRow[];
  lastDelivered(toKey: string): EventRow[];
  lastMessageSender(toKey: string): string | undefined;
  deliver(ids: number[], at: string): void;
  browse(filter: { to?: string; from?: string; kind?: EventKind; delivered?: boolean; before?: number }): Iterable<EventRow>;
}
export type EventTransport = (socket: string, events: { id: number; text: string }[]) => Promise<number[]>;
export interface TurnPrompt { origin: string; text: string }
export type TurnPromptReader = (transcriptPath: string) => TurnPrompt | undefined;
