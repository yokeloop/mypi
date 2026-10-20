CREATE TABLE work_chats_next (
  id TEXT PRIMARY KEY CHECK (length(id) > 0),
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  name TEXT,
  source_clone TEXT NOT NULL CHECK (length(source_clone) > 0),
  worktree TEXT NOT NULL CHECK (length(worktree) > 0),
  git_common_dir TEXT NOT NULL CHECK (length(git_common_dir) > 0),
  branch TEXT NOT NULL CHECK (length(branch) > 0),
  installation TEXT NOT NULL CHECK (length(installation) > 0),
  state_path TEXT NOT NULL CHECK (length(state_path) > 0),
  session_id TEXT UNIQUE,
  history_path TEXT UNIQUE,
  attempt_id TEXT NOT NULL UNIQUE CHECK (length(attempt_id) > 0),
  pane TEXT,
  process_id INTEGER,
  process_start TEXT,
  requested_provider TEXT,
  requested_model TEXT,
  phase TEXT NOT NULL CHECK (phase IN ('reserved', 'partial', 'auth-pending', 'ready', 'closed')),
  CHECK ((requested_provider IS NULL AND requested_model IS NULL) OR
         (length(requested_provider) > 0 AND length(requested_model) > 0)),
  CHECK ((session_id IS NULL AND history_path IS NULL) OR (session_id IS NOT NULL AND history_path IS NOT NULL)),
  CHECK (phase NOT IN ('ready', 'auth-pending') OR (session_id IS NOT NULL AND pane IS NOT NULL AND process_id IS NOT NULL AND process_start IS NOT NULL))
) STRICT;
INSERT INTO work_chats_next (id, request_id, project_id, name, source_clone, worktree, git_common_dir, branch,
  installation, state_path, session_id, history_path, attempt_id, pane, process_id, process_start, phase)
SELECT id, request_id, project_id, name, source_clone, worktree, git_common_dir, branch,
  installation, state_path, session_id, history_path, attempt_id, pane, process_id, process_start, phase FROM work_chats;
DROP TABLE work_chats;
ALTER TABLE work_chats_next RENAME TO work_chats;
CREATE UNIQUE INDEX work_chats_occupied_worktree ON work_chats(worktree) WHERE phase <> 'closed';
CREATE INDEX work_chats_request ON work_chats(request_id);
