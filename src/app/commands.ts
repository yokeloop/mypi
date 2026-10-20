import type { Scope } from '../shared/scope.js';
import type { ChatPreview } from './work-chats.js';
import type { ModelPair } from '../modules/work-chats/public.js';

export type TextInput = { text: string; file?: never } | { file: string; text?: never };
// A tagged reference preserves CLI syntax without colliding with the journal 'all' selector.
export type ScopeInput = Scope | { reference: string };
export type Artifact = { path: string; text?: string };
export type AppCommand =
  | { name: 'db_init' | 'bootstrap' | 'status_list' | 'journal_import' }
  | { name: 'project_list'; org?: string }
  | { name: 'project_add'; identity: string; code: string; checkoutPath?: string }
  | { name: 'project_update'; identity: string; expectedCheckoutPath: string | null; checkoutPath: string }
  | { name: 'project_resolve'; path: string }
  | { name: 'warmup' | 'memory_show'; scope: ScopeInput }
  | { name: 'memory_add' | 'journal_add'; scope: ScopeInput; text: string }
  | { name: 'memory_remove'; scope: ScopeInput; number: number; expectedRevision: string }
  | { name: 'capture'; source: TextInput }
  | { name: 'note_add'; scope: ScopeInput; title: string; body: TextInput }
  | { name: 'error_add'; project: string; text: string }
  | { name: 'journal_read'; scope: ScopeInput | 'all'; from?: string; to?: string; eventType?: 'note' | 'request_created' | 'status_changed'; limit?: number }
  | { name: 'request_list'; project?: string; status?: string }
  | { name: 'request_show' | 'request_touch'; key: string }
  | { name: 'request_create'; project: string | null; title: string; status: string; slug: string; source: TextInput; adoptSource?: boolean }
  | { name: 'request_status'; key: string; status: string; reason: string }
  | { name: 'request_title'; key: string; title: string; reason: string }
  | { name: 'request_progress'; key: string; text: string; artifacts?: Artifact[] }
  | { name: 'status_add' | 'status_terminal'; code: string; terminal: boolean }
  | { name: 'status_rename'; code: string; newCode: string }
  | { name: 'status_remove'; code: string }
  | { name: 'context_read'; path: string }
  | { name: 'context_commit'; paths: string[]; message: string }
  | { name: 'context_restore'; path: string; revision: string }
  | { name: 'backup'; destination: string }
  | { name: 'backup_publish'; dryRun?: boolean; selectedPaths?: string[] }
  | { name: 'restore'; backupDirectory: string }
  | { name: 'restore_published'; repository: string; commit: string }
  | { name: 'work_chat_open'; identity: string; requestId: number; sourceClone: string; worktree: string; nameLabel?: string; model?: ModelPair }
  | { name: 'work_chat_resume'; id: string; model?: ModelPair }
  | { name: 'work_chat_new_empty'; id: string; nameLabel?: string; model?: ModelPair }
  | { name: 'work_chat_execute'; preview: ChatPreview; focus?: boolean }
  | { name: 'work_chat_list' }
  | { name: 'work_chat_show'; id: string }
  | { name: 'work_chat_sync_attempt'; receipt: { attempt: string; sessionId: string; processId: number; generation: number;
    model: ModelPair; expectedTarget?: ModelPair }; adopt: boolean };
