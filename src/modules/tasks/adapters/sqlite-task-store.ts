import type { Database } from 'better-sqlite3';
import { InputError } from '../../../shared/errors.js';
import type { Card, TaskStore, Status } from '../ports.js';
const select = `SELECT r.id, r.project_id AS projectId, r.number, r.title, r.status_id AS statusId,
 s.code AS status, s.is_terminal AS isTerminal, r.context_dir AS contextDir, r.worktree_path AS worktreePath,
 r.created_at AS createdAt, r.updated_at AS updatedAt FROM tasks r JOIN task_statuses s ON s.id=r.status_id`;
function card(row: unknown): Card {
  if (!row) throw new InputError('Unknown task');
  const value = row as Card; return { ...value, isTerminal: Boolean(value.isTerminal) };
}
export function sqliteTaskStore(db: Database): TaskStore {
  const get = (id: number) => card(db.prepare(select + ' WHERE r.id = ?').get(id));
  return {
    transaction: fn => {
      if (db.readonly) throw new Error('Cannot mutate tasks through a readonly database');
      return db.transaction(fn).immediate();
    },
    statuses: () => db.prepare('SELECT id, code, is_terminal AS isTerminal FROM task_statuses ORDER BY id').all()
      .map(row => ({ ...(row as Status), isTerminal: Boolean((row as Status).isTerminal) })),
    addStatus(code, terminal) { db.prepare('INSERT INTO task_statuses(code,is_terminal) VALUES (?,?)').run(code, Number(terminal)); },
    renameStatus(code, next) { db.prepare('UPDATE task_statuses SET code=? WHERE code=?').run(next, code); },
    terminalStatus(code, terminal) { db.prepare('UPDATE task_statuses SET is_terminal=? WHERE code=?').run(Number(terminal), code); },
    removeStatus(code) { db.prepare('DELETE FROM task_statuses WHERE code=?').run(code); },
    nextNumber(projectId) { return (db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM tasks WHERE project_id IS ?').get(projectId) as { n: number }).n; },
    insert(input) {
      const row = db.prepare(`INSERT INTO tasks(project_id,number,title,status_id,context_dir,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?)`).run(input.projectId,input.number,input.title,input.statusId,input.contextDir,input.createdAt,input.updatedAt);
      return get(Number(row.lastInsertRowid));
    },
    list: () => db.prepare(select + ' ORDER BY r.id').all().map(card),
    get,
    update(id, title, statusId, at) {
      db.prepare('UPDATE tasks SET title=?,status_id=?,updated_at=? WHERE id=?').run(title,statusId,at,id);
      return get(id);
    },
    relocate(id, contextDir) {
      db.prepare('UPDATE tasks SET context_dir=? WHERE id=?').run(contextDir, id);
      return get(id);
    },
    setWorktree(id, worktreePath) {
      db.prepare('UPDATE tasks SET worktree_path=? WHERE id=?').run(worktreePath, id);
      return get(id);
    },
  };
}
