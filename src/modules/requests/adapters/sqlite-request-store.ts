import type { Database } from 'better-sqlite3';
import { InputError } from '../../../shared/errors.js';
import type { Card, RequestStore, Status } from '../ports.js';
const select = `SELECT r.id, r.project_id AS projectId, r.number, r.title, r.status_id AS statusId,
 s.code AS status, s.is_terminal AS isTerminal, r.context_dir AS contextDir,
 r.created_at AS createdAt, r.updated_at AS updatedAt FROM requests r JOIN request_statuses s ON s.id=r.status_id`;
function card(row: unknown): Card {
  if (!row) throw new InputError('Unknown request');
  const value = row as Card; return { ...value, isTerminal: Boolean(value.isTerminal) };
}
export function sqliteRequestStore(db: Database): RequestStore {
  const get = (id: number) => card(db.prepare(select + ' WHERE r.id = ?').get(id));
  return {
    transaction: fn => {
      if (db.readonly) throw new Error('Cannot mutate requests through a readonly database');
      return db.transaction(fn).immediate();
    },
    statuses: () => db.prepare('SELECT id, code, is_terminal AS isTerminal FROM request_statuses ORDER BY id').all()
      .map(row => ({ ...(row as Status), isTerminal: Boolean((row as Status).isTerminal) })),
    addStatus(code, terminal) { db.prepare('INSERT INTO request_statuses(code,is_terminal) VALUES (?,?)').run(code, Number(terminal)); },
    renameStatus(code, next) { db.prepare('UPDATE request_statuses SET code=? WHERE code=?').run(next, code); },
    terminalStatus(code, terminal) { db.prepare('UPDATE request_statuses SET is_terminal=? WHERE code=?').run(Number(terminal), code); },
    removeStatus(code) { db.prepare('DELETE FROM request_statuses WHERE code=?').run(code); },
    nextNumber(projectId) { return (db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM requests WHERE project_id IS ?').get(projectId) as { n: number }).n; },
    insert(input) {
      const row = db.prepare(`INSERT INTO requests(project_id,number,title,status_id,context_dir,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?)`).run(input.projectId,input.number,input.title,input.statusId,input.contextDir,input.createdAt,input.updatedAt);
      return get(Number(row.lastInsertRowid));
    },
    list: () => db.prepare(select + ' ORDER BY r.id').all().map(card),
    get,
    update(id, title, statusId, at) {
      db.prepare('UPDATE requests SET title=?,status_id=?,updated_at=? WHERE id=?').run(title,statusId,at,id);
      return get(id);
    },
  };
}
