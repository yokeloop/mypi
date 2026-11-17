import type { Database } from 'better-sqlite3';
import type { Agent, SessionRow, SessionStore } from '../ports.js';
const select = `SELECT id, key, scope_type AS scopeType, org_id AS orgId, project_id AS projectId, task_id AS taskId, agent, native_id AS nativeId,
 device, created_at AS createdAt, active_at AS activeAt, ended_at AS endedAt FROM sessions`;
const activity = ' ORDER BY active_at DESC NULLS LAST, id DESC';
export function sqliteSessionStore(db: Database): SessionStore {
  return {
    transaction: fn => db.readonly ? db.transaction(fn)() : db.transaction(fn).immediate(),
    active: (key: string) => db.prepare(select + ' WHERE key = ?' + activity + ' LIMIT 1').get(key) as SessionRow | undefined,
    rows: (key: string) => db.prepare(select + ' WHERE key = ?' + activity).all(key) as SessionRow[],
    byNative: (agent: Agent, nativeId: string) => db.prepare(select + ' WHERE agent = ? AND native_id = ?').get(agent, nativeId) as SessionRow | undefined,
    save(row) {
      return (db.prepare(`INSERT INTO sessions(key,scope_type,org_id,project_id,task_id,agent,native_id,device,created_at) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(agent, native_id) DO UPDATE SET scope_type=excluded.scope_type, org_id=excluded.org_id, project_id=excluded.project_id,
        task_id=excluded.task_id, device=excluded.device RETURNING id`)
        .get(row.key, row.scopeType, row.orgId, row.projectId, row.taskId, row.agent, row.nativeId, row.device, row.createdAt) as { id: number }).id;
    },
    touch(id, at) { db.prepare('UPDATE sessions SET active_at = ? WHERE id = ?').run(at, id); },
    removeKey: key => db.prepare('DELETE FROM sessions WHERE key = ?').run(key).changes,
    list: () => db.prepare(select + ' ORDER BY key, active_at DESC NULLS LAST, id DESC').all() as SessionRow[],
  };
}
