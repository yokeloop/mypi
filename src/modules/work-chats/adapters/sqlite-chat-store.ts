import type Database from 'better-sqlite3';
import type { ChatStore, WorkChat } from '../chat.js';

const columns = `id, request_id AS requestId, project_id AS projectId, name, source_clone AS sourceClone,
  worktree, git_common_dir AS gitCommonDir, branch, installation, state_path AS statePath,
  session_id AS sessionId, history_path AS historyPath, attempt_id AS attemptId, pane,
  process_id AS processId, process_start AS processStart, phase`;

export function sqliteChatStore(db: Database.Database): ChatStore {
  const list = db.prepare(`SELECT ${columns} FROM work_chats ORDER BY rowid`);
  const get = db.prepare(`SELECT ${columns} FROM work_chats WHERE id = ?`);
  const byWorktree = db.prepare(`SELECT ${columns} FROM work_chats WHERE worktree = ? AND phase <> 'closed'`);
  const insert = db.prepare(`INSERT INTO work_chats
    (id, request_id, project_id, name, source_clone, worktree, git_common_dir, branch, installation,
     state_path, session_id, history_path, attempt_id, pane, process_id, process_start, phase)
    VALUES (@id, @requestId, @projectId, @name, @sourceClone, @worktree, @gitCommonDir, @branch,
      @installation, @statePath, @sessionId, @historyPath, @attemptId, @pane, @processId, @processStart, @phase)`);
  const update = db.prepare(`UPDATE work_chats SET session_id = @sessionId, history_path = @historyPath,
    pane = @pane, process_id = @processId, process_start = @processStart, phase = @phase, attempt_id = @attemptId
    WHERE id = @id AND attempt_id = @previousAttempt`);
  const release = db.prepare(`DELETE FROM work_chats WHERE id = ? AND attempt_id = ? AND phase = 'partial'
    AND session_id IS NULL AND history_path IS NULL`);
  const retire = db.prepare(`UPDATE work_chats SET phase = 'closed' WHERE id = ? AND attempt_id = ?
    AND phase IN ('ready', 'partial')`);
  return {
    list: () => list.all() as WorkChat[],
    get: id => get.get(id) as WorkChat | undefined,
    byWorktree: path => byWorktree.get(path) as WorkChat | undefined,
    reserve: chat => { insert.run(chat); },
    update: (chat, previousAttempt = chat.attemptId) => {
      if (update.run({ ...chat, previousAttempt }).changes !== 1) throw new Error('Stale work chat attempt');
    },
    releaseUnused: (id, attemptId) => { if (release.run(id, attemptId).changes !== 1) throw new Error('Work chat is not a proven unused reservation'); },
    retireEmpty: (id, attemptId) => { if (retire.run(id, attemptId).changes !== 1) throw new Error('Stale empty chat retirement'); },
    transaction: work => db.transaction(work).immediate(),
  };
}
