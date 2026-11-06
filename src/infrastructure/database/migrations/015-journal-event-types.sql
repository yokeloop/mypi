CREATE TABLE knowledge_journal_next (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'org', 'project', 'task')),
  scope_key TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('note', 'task_created', 'status_changed', 'title_changed', 'worktree_created', 'session_opened', 'message_sent', 'clone_prepared')),
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  artifacts_json TEXT,
  import_path TEXT,
  import_line INTEGER,
  CHECK ((scope_type = 'global' AND scope_key IS NULL) OR (scope_type <> 'global' AND scope_key IS NOT NULL)),
  CHECK ((import_path IS NULL AND import_line IS NULL) OR (import_path IS NOT NULL AND import_line > 0)),
  UNIQUE (import_path, import_line)
) STRICT;
INSERT INTO knowledge_journal_next (id, at, scope_type, scope_key, event_type, text, artifacts_json, import_path, import_line)
SELECT id, at, scope_type, scope_key, event_type, text, artifacts_json, import_path, import_line FROM knowledge_journal ORDER BY id;
DROP TABLE knowledge_journal;
ALTER TABLE knowledge_journal_next RENAME TO knowledge_journal;
CREATE INDEX knowledge_journal_order ON knowledge_journal(at, id);
