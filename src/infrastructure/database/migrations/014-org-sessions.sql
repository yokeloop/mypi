DROP TRIGGER used_project_code;

CREATE TABLE sessions_new (
  key TEXT NOT NULL PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'org', 'project', 'task')),
  org_id INTEGER REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
  task_id INTEGER REFERENCES tasks(id) ON DELETE RESTRICT,
  agent TEXT NOT NULL CHECK (agent IN ('claude', 'pi')),
  native_id TEXT NOT NULL CHECK (length(native_id) > 0),
  created_at TEXT NOT NULL,
  CHECK ((scope_type = 'global' AND key = 'global' AND org_id IS NULL AND project_id IS NULL AND task_id IS NULL)
    OR (scope_type = 'org' AND key <> 'global' AND org_id IS NOT NULL AND project_id IS NULL AND task_id IS NULL)
    OR (scope_type = 'project' AND key <> 'global' AND org_id IS NULL AND project_id IS NOT NULL AND task_id IS NULL)
    OR (scope_type = 'task' AND key <> 'global' AND org_id IS NULL AND project_id IS NOT NULL AND task_id IS NOT NULL)),
  UNIQUE (agent, native_id)
) STRICT;

INSERT INTO sessions_new(key, scope_type, org_id, project_id, task_id, agent, native_id, created_at)
  SELECT key, scope_type, NULL, project_id, task_id, agent, native_id, created_at FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE TRIGGER used_project_code BEFORE UPDATE OF code ON projects
WHEN OLD.code <> NEW.code AND (EXISTS (SELECT 1 FROM tasks WHERE project_id = OLD.id)
  OR EXISTS (SELECT 1 FROM sessions WHERE project_id = OLD.id))
BEGIN
  SELECT RAISE(ABORT, 'Cannot rename a project code with tasks or sessions');
END;
