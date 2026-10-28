CREATE TABLE sessions (
  key TEXT NOT NULL PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'project', 'task')),
  project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
  task_id INTEGER REFERENCES tasks(id) ON DELETE RESTRICT,
  agent TEXT NOT NULL CHECK (agent IN ('claude', 'pi')),
  native_id TEXT NOT NULL CHECK (length(native_id) > 0),
  created_at TEXT NOT NULL,
  CHECK ((scope_type = 'global' AND key = 'global' AND project_id IS NULL AND task_id IS NULL)
    OR (scope_type = 'project' AND key <> 'global' AND project_id IS NOT NULL AND task_id IS NULL)
    OR (scope_type = 'task' AND key <> 'global' AND project_id IS NOT NULL AND task_id IS NOT NULL)),
  UNIQUE (agent, native_id)
) STRICT;

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  from_key TEXT NOT NULL,
  to_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('turn_end', 'waiting')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT
) STRICT;

DROP TRIGGER used_project_code;
CREATE TRIGGER used_project_code BEFORE UPDATE OF code ON projects
WHEN OLD.code <> NEW.code AND (EXISTS (SELECT 1 FROM tasks WHERE project_id = OLD.id)
  OR EXISTS (SELECT 1 FROM sessions WHERE project_id = OLD.id))
BEGIN
  SELECT RAISE(ABORT, 'Cannot rename a project code with tasks or sessions');
END;
