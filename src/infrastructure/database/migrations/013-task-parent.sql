-- A task's parent task (same project, checked by the application); NULL for a top-level task.
ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE RESTRICT;
CREATE INDEX tasks_parent ON tasks(parent_id);
