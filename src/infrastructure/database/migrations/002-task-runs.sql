-- Runtime lifecycle is independent of request status and engineer acceptance.
CREATE TABLE task_runs (
  id TEXT PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  request_key TEXT NOT NULL,
  unit TEXT NOT NULL,
  session_id TEXT NOT NULL,
  worktree TEXT NOT NULL,
  base_revision TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('prepared','starting','running','stopping','stopped','failed')),
  pane TEXT,
  tab TEXT,
  invocation TEXT,
  session_file TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE UNIQUE INDEX task_runs_one_active_unit ON task_runs(unit)
  WHERE state IN ('prepared','starting','running','stopping');
CREATE UNIQUE INDEX task_runs_one_active_request ON task_runs(request_id)
  WHERE state IN ('prepared','starting','running','stopping');
CREATE UNIQUE INDEX task_runs_one_active_worktree ON task_runs(worktree)
  WHERE state IN ('prepared','starting','running','stopping');
