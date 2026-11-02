-- A project's source: a Git remote URL or 'local'; NULL until set.
ALTER TABLE projects ADD COLUMN repository TEXT CHECK (repository IS NULL OR length(trim(repository)) > 0);
