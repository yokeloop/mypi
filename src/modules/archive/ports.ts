export type ArchiveRole = 'user' | 'assistant';
export type ArchiveOrigin = 'human' | 'peer' | 'task_notification' | 'frame';
export interface ArchiveEntry { entryId: string; parentEntryId: string | null; at: string; role: ArchiveRole; origin: ArchiveOrigin; text: string }
export interface ArchiveRead { entries: ArchiveEntry[]; offset: number; name: string | null; cwd: string | null; parentNativeId: string | null }
export type TranscriptReader = (path: string, offset: number) => ArchiveRead;
