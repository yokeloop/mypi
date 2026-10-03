CREATE TABLE organizations (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (length(trim(slug)) > 0)
) STRICT;

CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL CHECK (length(trim(slug)) > 0),
  code TEXT NOT NULL UNIQUE CHECK (code <> '' AND code NOT GLOB '*[^A-Z]*' AND code <> 'REQ'),
  checkout_path TEXT,
  UNIQUE (org_id, slug)
) STRICT;

CREATE TABLE request_statuses (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0),
  is_terminal INTEGER NOT NULL CHECK (is_terminal IN (0, 1))
) STRICT;

CREATE TABLE requests (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
  number INTEGER NOT NULL CHECK (number > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  status_id INTEGER NOT NULL REFERENCES request_statuses(id) ON DELETE RESTRICT,
  context_dir TEXT NOT NULL UNIQUE CHECK (length(context_dir) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, number)
) STRICT;

CREATE UNIQUE INDEX requests_unassigned_number ON requests(number) WHERE project_id IS NULL;

CREATE TRIGGER used_status_terminality BEFORE UPDATE OF is_terminal ON request_statuses
WHEN OLD.is_terminal <> NEW.is_terminal AND EXISTS (SELECT 1 FROM requests WHERE status_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'Cannot change terminality of a used status');
END;

CREATE TRIGGER used_project_code BEFORE UPDATE OF code ON projects
WHEN OLD.code <> NEW.code AND EXISTS (SELECT 1 FROM requests WHERE project_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'Cannot rename a project code with requests');
END;

CREATE TRIGGER preserve_request_numbers BEFORE DELETE ON requests
BEGIN
  SELECT RAISE(ABORT, 'Saved requests cannot be deleted');
END;

INSERT INTO request_statuses(code, is_terminal) VALUES
  ('new', 0), ('research', 0), ('planning', 0), ('in_progress', 0), ('review', 0),
  ('blocked', 0), ('paused', 0), ('done', 1), ('failed', 1), ('cancelled', 1);
