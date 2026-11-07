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
export interface ArchiveStore {
  transaction<T>(fn: () => T): T;
  session(agent: ArchiveAgent, nativeId: string): ArchiveSession | undefined;
  saveSession(row: ArchiveSession): void;
  insertMessages(agent: ArchiveAgent, nativeId: string, entries: ArchiveEntry[]): number;
}
export interface KeyLookup {
  byNative(agent: ArchiveAgent, nativeId: string): string | undefined;
  registered(key: string): boolean;
}
