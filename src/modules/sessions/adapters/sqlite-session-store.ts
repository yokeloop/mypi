import type { Database } from 'better-sqlite3';
import type { Agent, SessionRow, SessionStore } from '../ports.js';
const select = `SELECT key, scope_type AS scopeType, project_id AS projectId, task_id AS taskId, agent, native_id AS nativeId,
 created_at AS createdAt FROM sessions`;
export function sqliteSessionStore(db: Database): SessionStore {
  return {
    transaction: fn => db.readonly ? db.transaction(fn)() : db.transaction(fn).immediate(),
    get: (key: string) => db.prepare(select + ' WHERE key = ?').get(key) as SessionRow | undefined,
    byNative: (agent: Agent, nativeId: string) => db.prepare(select + ' WHERE agent = ? AND native_id = ?').get(agent, nativeId) as SessionRow | undefined,
    save(row) {
      db.prepare(`INSERT INTO sessions(key,scope_type,project_id,task_id,agent,native_id,created_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET scope_type=excluded.scope_type, project_id=excluded.project_id, task_id=excluded.task_id,
        agent=excluded.agent, native_id=excluded.native_id`)
        .run(row.key, row.scopeType, row.projectId, row.taskId, row.agent, row.nativeId, row.createdAt);
    },
    remove(key) { db.prepare('DELETE FROM sessions WHERE key = ?').run(key); },
    list: () => db.prepare(select + ' ORDER BY key').all() as SessionRow[],
  };
}
