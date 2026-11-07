CREATE TABLE archive_sessions (
  id INTEGER PRIMARY KEY,
  agent TEXT NOT NULL CHECK (agent IN ('claude', 'pi')),
  native_id TEXT NOT NULL,
  path TEXT NOT NULL,
  cwd TEXT,
  key TEXT,
  key_source TEXT CHECK (key_source IN ('sessions', 'name')),
  parent_native_id TEXT,
  first_at TEXT,
  last_at TEXT,
  bytes_read INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (agent, native_id)
) STRICT;

CREATE TABLE archive_messages (
  id INTEGER PRIMARY KEY,
  agent TEXT NOT NULL,
  native_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  parent_entry_id TEXT,
  at TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  origin TEXT NOT NULL CHECK (origin IN ('human', 'peer', 'task_notification', 'frame')),
  text TEXT NOT NULL CHECK (length(text) > 0),
  UNIQUE (agent, native_id, entry_id),
  FOREIGN KEY (agent, native_id) REFERENCES archive_sessions(agent, native_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX archive_messages_at ON archive_messages(at);

CREATE VIRTUAL TABLE archive_fts USING fts5(text, content='archive_messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2');

CREATE TRIGGER archive_messages_ai AFTER INSERT ON archive_messages BEGIN
  INSERT INTO archive_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER archive_messages_ad AFTER DELETE ON archive_messages BEGIN
  INSERT INTO archive_fts(archive_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER archive_messages_au AFTER UPDATE ON archive_messages BEGIN
  INSERT INTO archive_fts(archive_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO archive_fts(rowid, text) VALUES (new.id, new.text);
END;
