import type { Scope } from '../shared/scope.js';

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
  | { name: 'journal_read'; scope: ScopeInput | 'all'; from?: string; to?: string; eventType?: 'note' | 'task_created' | 'status_changed'; limit?: number }
  | { name: 'task_list'; project?: string; status?: string }
  | { name: 'task_show' | 'task_touch'; key: string }
  | { name: 'task_create'; project: string; title: string; status: string; slug: string; source: TextInput; adoptSource?: boolean }
  | { name: 'task_status'; key: string; status: string; reason: string }
  | { name: 'task_title'; key: string; title: string; reason: string }
  | { name: 'task_progress'; key: string; text: string; artifacts?: Artifact[] }
  | { name: 'status_add' | 'status_terminal'; code: string; terminal: boolean }
  | { name: 'status_rename'; code: string; newCode: string }
  | { name: 'status_remove'; code: string }
  | { name: 'context_read'; path: string }
  | { name: 'context_commit'; paths: string[]; message: string }
  | { name: 'context_restore'; path: string; revision: string }
  | { name: 'backup'; destination: string }
  | { name: 'backup_publish'; dryRun?: boolean; selectedPaths?: string[] }
  | { name: 'restore'; backupDirectory: string }
  | { name: 'restore_published'; repository: string; commit: string };
