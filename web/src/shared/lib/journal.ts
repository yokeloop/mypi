export const JOURNAL_TYPES = ['note', 'task_created', 'status_changed', 'title_changed', 'worktree_created', 'session_opened', 'message_sent', 'clone_prepared'] as const;
export type JournalType = typeof JOURNAL_TYPES[number];
export const JOURNAL_COLORS: Record<JournalType, string> = {
  note: 'blue', task_created: 'green', status_changed: 'orange', title_changed: 'yellow',
  worktree_created: 'teal', session_opened: 'indigo', message_sent: 'violet', clone_prepared: 'grape',
};
