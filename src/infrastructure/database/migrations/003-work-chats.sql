CREATE TABLE work_chats (
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
  phase TEXT NOT NULL CHECK (phase IN ('reserved', 'partial', 'ready', 'closed')),
  CHECK ((session_id IS NULL AND history_path IS NULL) OR (session_id IS NOT NULL AND history_path IS NOT NULL)),
  CHECK (phase <> 'ready' OR (session_id IS NOT NULL AND pane IS NOT NULL AND process_id IS NOT NULL AND process_start IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX work_chats_occupied_worktree ON work_chats(worktree) WHERE phase <> 'closed';
CREATE INDEX work_chats_request ON work_chats(request_id);
