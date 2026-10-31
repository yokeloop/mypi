CREATE TABLE events_new (
  id INTEGER PRIMARY KEY,
  from_key TEXT NOT NULL,
  to_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('turn_end', 'waiting', 'milestone')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT
) STRICT;

INSERT INTO events_new(id, from_key, to_key, kind, message, created_at, delivered_at)
  SELECT id, from_key, to_key, kind, message, created_at, delivered_at FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
