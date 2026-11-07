import type { Scope } from '../shared/scope.js';
import type { SessionHint } from './session-input.js';
import type { EventType } from '../modules/knowledge/public.js';
export { EVENT_TYPES } from '../modules/knowledge/public.js';
export type { EventType } from '../modules/knowledge/public.js';

export type TextInput = { text: string; file?: never } | { file: string; text?: never };
// A tagged reference preserves CLI syntax without colliding with the journal 'all' selector.
export type ScopeInput = Scope | { reference: string };
export type Artifact = { path: string; text?: string };
export type RunContext = { signal?: AbortSignal; onProgress?: (line: string) => void };
export type AppCommand =
  | { name: 'db_init' | 'bootstrap' | 'status_list' | 'journal_import' }
  | { name: 'project_list'; org?: string }
  | { name: 'project_add'; identity: string; code: string; checkoutPath?: string; repository?: string }
  | { name: 'project_update'; identity: string; expectedCheckoutPath?: string | null; checkoutPath?: string; expectedRepository?: string | null; repository?: string }
  | { name: 'project_resolve'; path: string }
  | { name: 'project_flow'; project: string }
  | { name: 'project_remove'; identity: string; expectedCode: string }
  | { name: 'org_remove'; org: string }
  | { name: 'warmup'; scope?: string; envScope?: string; maxChars?: number; session?: SessionHint }
  | { name: 'journal_add'; scope: ScopeInput; text: string }
  | { name: 'capture'; source: TextInput }
  | { name: 'note_add'; scope: ScopeInput; title: string; body: TextInput }
  | { name: 'error_add'; project: string; text: string }
  | { name: 'journal_read'; scope: ScopeInput | 'all'; from?: string; to?: string; eventType?: EventType; limit?: number }
  | { name: 'journal_page'; scope: ScopeInput | 'all'; from?: string; to?: string; eventType?: EventType; q?: string; before?: number; limit: number }
  | { name: 'task_list'; project?: string; status?: string }
  | { name: 'task_page'; project?: string; status?: string; q?: string; before?: number; limit: number }
  | { name: 'task_show' | 'task_touch' | 'task_worktree'; key: string }
  | { name: 'task_create'; project: string; title: string; status: string; slug: string; source: TextInput; adoptSource?: boolean; parent?: string }
  | { name: 'task_status'; key: string; status: string; reason: string; session?: SessionHint; envScope?: string }
  | { name: 'task_title'; key: string; title: string; reason: string }
  | { name: 'task_parent'; key: string; parent: string | null; reason: string }
  | { name: 'task_progress'; key: string; text: string; artifacts?: Artifact[] }
  | { name: 'status_add' | 'status_terminal'; code: string; terminal: boolean }
  | { name: 'status_rename'; code: string; newCode: string }
  | { name: 'status_remove'; code: string }
  | { name: 'context_read'; path: string; revision?: string }
  | { name: 'context_commit'; paths: string[]; message: string }
  | { name: 'context_restore'; path: string; revision: string }
  | { name: 'backup'; destination: string }
  | { name: 'backup_publish'; dryRun?: boolean; selectedPaths?: string[] }
  | { name: 'restore'; backupDirectory: string }
  | { name: 'restore_published'; repository: string; commit: string }
  | { name: 'home_migrate_tasks'; dryRun?: boolean }
  | { name: 'session_register'; agent: 'claude' | 'pi'; pid: number; nativeId: string; sessionName?: string; socket?: string; fork: boolean; envScope?: string; runtime?: string }
  | { name: 'session_unregister'; pid: number; runtime?: string }
  | { name: 'session_forget'; key: string; runtime?: string }
  | { name: 'sessions'; runtime?: string }
  | { name: 'archive_import'; home: string; dirs?: { agent: 'claude' | 'pi'; path: string }[] }
  | { name: 'archive_status' }
  | { name: 'archive_capture'; agent: 'claude' | 'pi'; file?: string; nativeId?: string }
  | { name: 'archive_search'; q?: string; scope?: string; agent?: 'claude' | 'pi'; from?: string; to?: string; includePeer?: boolean; limit?: number }
  | { name: 'archive_show'; id?: number; before?: number; after?: number; session?: string; agent?: 'claude' | 'pi'; offset?: number; limit?: number; includePeer?: boolean }
  | { name: 'archive_forget'; session?: string; key?: string; before?: string }
  | { name: 'event_emit'; kind: 'turn_end' | 'waiting'; message: string; from?: string; to?: string; notification?: string;
      session?: SessionHint; envScope?: string; runtime?: string; transcript?: string }
  | { name: 'turn_end'; nativeId: string; active: boolean; message: string; pid: number; envScope?: string; runtime?: string;
      transcript?: string }
  | { name: 'event_list'; to?: string; from?: string; kind?: 'turn_end' | 'waiting' | 'milestone' | 'message'; delivered?: boolean; q?: string; before?: number; limit: number }
  | { name: 'inbox'; key?: string; session?: SessionHint; envScope?: string }
  | { name: 'message_send'; key: string; body: TextInput; session?: SessionHint; envScope?: string; runtime?: string }
  | { name: 'api_token_create'; file: string; tokenName: string; permission: string; sender?: string }
  | { name: 'api_token_list'; file: string }
  | { name: 'api_token_revoke'; file: string; tokenName: string }
  | { name: 'open_session'; keys: string[]; agent?: 'claude' | 'pi'; permissionMode?: string;
      session?: SessionHint; stateHome?: string; runtime?: string; message?: string; envScope?: string };
