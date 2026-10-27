ALTER TABLE requests RENAME TO tasks;
ALTER TABLE request_statuses RENAME TO task_statuses;
ALTER TABLE tasks ADD COLUMN worktree_path TEXT;

DROP INDEX requests_unassigned_number;
CREATE UNIQUE INDEX tasks_unassigned_number ON tasks(number) WHERE project_id IS NULL;

DROP TRIGGER used_status_terminality;
CREATE TRIGGER used_status_terminality BEFORE UPDATE OF is_terminal ON task_statuses
WHEN OLD.is_terminal <> NEW.is_terminal AND EXISTS (SELECT 1 FROM tasks WHERE status_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'Cannot change terminality of a used status');
END;

DROP TRIGGER used_project_code;
CREATE TRIGGER used_project_code BEFORE UPDATE OF code ON projects
WHEN OLD.code <> NEW.code AND EXISTS (SELECT 1 FROM tasks WHERE project_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'Cannot rename a project code with tasks');
END;

DROP TRIGGER preserve_request_numbers;
CREATE TRIGGER preserve_task_numbers BEFORE DELETE ON tasks
BEGIN
  SELECT RAISE(ABORT, 'Saved tasks cannot be deleted');
END;

CREATE TABLE knowledge_journal_next (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'org', 'project', 'task')),
  scope_key TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('note', 'task_created', 'status_changed')),
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  artifacts_json TEXT,
  import_path TEXT,
  import_line INTEGER,
  CHECK ((scope_type = 'global' AND scope_key IS NULL) OR (scope_type <> 'global' AND scope_key IS NOT NULL)),
  CHECK ((import_path IS NULL AND import_line IS NULL) OR (import_path IS NOT NULL AND import_line > 0)),
  UNIQUE (import_path, import_line)
) STRICT;
INSERT INTO knowledge_journal_next (id, at, scope_type, scope_key, event_type, text, artifacts_json, import_path, import_line)
SELECT id, at, CASE scope_type WHEN 'request' THEN 'task' ELSE scope_type END, scope_key,
  CASE event_type WHEN 'request_created' THEN 'task_created' ELSE event_type END,
  text, artifacts_json, import_path, import_line
FROM knowledge_journal ORDER BY id;
DROP TABLE knowledge_journal;
ALTER TABLE knowledge_journal_next RENAME TO knowledge_journal;
CREATE INDEX knowledge_journal_order ON knowledge_journal(at, id);
