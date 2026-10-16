CREATE TABLE knowledge_journal (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'org', 'project', 'request')),
  scope_key TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('note', 'request_created', 'status_changed')),
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  artifacts_json TEXT,
  import_path TEXT,
  import_line INTEGER,
  CHECK ((scope_type = 'global' AND scope_key IS NULL) OR (scope_type <> 'global' AND scope_key IS NOT NULL)),
  CHECK ((import_path IS NULL AND import_line IS NULL) OR (import_path IS NOT NULL AND import_line > 0)),
  UNIQUE (import_path, import_line)
) STRICT;
CREATE INDEX knowledge_journal_order ON knowledge_journal(at, id);

CREATE TABLE knowledge_journal_imports (
  path TEXT PRIMARY KEY CHECK (length(path) > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  imported_at TEXT NOT NULL
) STRICT;

CREATE TABLE knowledge_file_fingerprints (
  path TEXT PRIMARY KEY CHECK (length(path) > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  registered_at TEXT NOT NULL
) STRICT;
