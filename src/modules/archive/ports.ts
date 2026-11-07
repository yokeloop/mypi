export type ArchiveRole = 'user' | 'assistant';
export type ArchiveOrigin = 'human' | 'peer' | 'task_notification' | 'frame';
export interface ArchiveEntry { entryId: string; parentEntryId: string | null; at: string; role: ArchiveRole; origin: ArchiveOrigin; text: string }
export interface ArchiveRead { entries: ArchiveEntry[]; offset: number; name: string | null; cwd: string | null; parentNativeId: string | null }
export type TranscriptReader = (path: string, offset: number) => ArchiveRead;
export type ArchiveAgent = 'claude' | 'pi';
export type KeySource = 'sessions' | 'name';
export interface ArchiveSession {
  agent: ArchiveAgent; nativeId: string; path: string; cwd: string | null;
  key: string | null; keySource: KeySource | null; parentNativeId: string | null;
  firstAt: string | null; lastAt: string | null; bytesRead: number; updatedAt: string;
}
export interface ArchiveKeys { exact: string[]; projects: string[] }
export interface ArchiveFilter { keys: ArchiveKeys | null; agent?: ArchiveAgent; from?: string; to?: string; includePeer: boolean }
export interface ArchiveHit { id: number; agent: ArchiveAgent; key: string | null; session: string; at: string; role: ArchiveRole; origin: ArchiveOrigin; snippet: string }
export interface ArchiveSessionHits { agent: ArchiveAgent; session: string; key: string | null; firstAt: string; lastAt: string; messages: number }
export interface ArchiveMessage { id: number; at: string; role: ArchiveRole; origin: ArchiveOrigin; text: string }
export interface ArchiveAnchor extends ArchiveMessage { agent: ArchiveAgent; session: string }
export interface ArchiveStore {
  transaction<T>(fn: () => T): T;
  session(agent: ArchiveAgent, nativeId: string): ArchiveSession | undefined;
  saveSession(row: ArchiveSession): void;
  insertMessages(agent: ArchiveAgent, nativeId: string, entries: ArchiveEntry[]): number;
  counts(): ArchiveCounts;
  search(match: string, filter: ArchiveFilter, limit: number): ArchiveHit[];
  sessionList(filter: ArchiveFilter, limit: number): ArchiveSessionHits[];
  message(id: number): ArchiveAnchor | undefined;
  around(anchor: ArchiveAnchor, before: number, after: number, includePeer: boolean): { before: ArchiveMessage[]; after: ArchiveMessage[] };
  agentsOf(nativeId: string): ArchiveAgent[];
  page(agent: ArchiveAgent, nativeId: string, offset: number, limit: number, includePeer: boolean): { messages: ArchiveMessage[]; total: number };
}
export interface KeyLookup {
  byNative(agent: ArchiveAgent, nativeId: string): string | undefined;
  registered(key: string): boolean;
}
export interface TranscriptFiles { list(dir: string): string[] }
export interface ArchiveFolder { agent: ArchiveAgent; path: string }
export interface ArchiveCounts {
  sessions: Record<ArchiveAgent, number>; messages: Record<ArchiveAgent, number>;
  boundSessions: number; unboundSessions: number; keys: number;
  keySources: Record<KeySource, number>;
}
