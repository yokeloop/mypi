import type Database from 'better-sqlite3';
import type { ChatStore, WorkChat } from '../chat.js';

const columns = `id, request_id AS requestId, project_id AS projectId, name, source_clone AS sourceClone,
  worktree, git_common_dir AS gitCommonDir, branch, installation, state_path AS statePath,
  session_id AS sessionId, history_path AS historyPath, attempt_id AS attemptId, pane,
  process_id AS processId, process_start AS processStart, requested_provider AS requestedProvider, requested_model AS requestedModel, process_boot_id AS processBootId, herdr_endpoint AS herdrEndpoint, phase`;

export function sqliteChatStore(db: Database.Database): ChatStore {
  const list = db.prepare(`SELECT ${columns} FROM work_chats ORDER BY rowid`);
  const get = db.prepare(`SELECT ${columns} FROM work_chats WHERE id = ?`);
  const byWorktree = db.prepare(`SELECT ${columns} FROM work_chats WHERE worktree = ? AND phase <> 'closed'`);
  const insert = db.prepare(`INSERT INTO work_chats
    (id, request_id, project_id, name, source_clone, worktree, git_common_dir, branch, installation,
     state_path, session_id, history_path, attempt_id, pane, process_id, process_start, requested_provider, requested_model, process_boot_id, herdr_endpoint, phase)
    VALUES (@id, @requestId, @projectId, @name, @sourceClone, @worktree, @gitCommonDir, @branch,
      @installation, @statePath, @sessionId, @historyPath, @attemptId, @pane, @processId, @processStart, @requestedProvider, @requestedModel, @processBootId, @herdrEndpoint, @phase)`);
  const update = db.prepare(`UPDATE work_chats SET session_id = @sessionId, history_path = @historyPath,
    pane = @pane, process_id = @processId, process_start = @processStart, phase = @phase, requested_provider = @requestedProvider, requested_model = @requestedModel, attempt_id = @attemptId, process_boot_id = @processBootId, herdr_endpoint = @herdrEndpoint
    WHERE id = @id AND attempt_id = @previousAttempt`);
  const retire = db.prepare(`UPDATE work_chats SET phase = 'closed' WHERE id = ? AND attempt_id = ?
    AND phase IN ('ready', 'auth-pending', 'partial')`);
  return {
    list: () => list.all() as WorkChat[],
    get: id => get.get(id) as WorkChat | undefined,
    byWorktree: path => byWorktree.get(path) as WorkChat | undefined,
    reserve: chat => { insert.run({ processBootId: null, herdrEndpoint: null, ...chat }); },
    update: (chat, previousAttempt = chat.attemptId) => {
      if (update.run({ processBootId: null, herdrEndpoint: null, ...chat, previousAttempt }).changes !== 1) throw new Error('Stale work chat attempt');
    },
    retireEmpty: (id, attemptId) => { if (retire.run(id, attemptId).changes !== 1) throw new Error('Stale empty chat retirement'); },
    transaction: work => db.transaction(work).immediate(),
  };
}
