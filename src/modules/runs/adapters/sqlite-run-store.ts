import type Database from 'better-sqlite3';
import type { RunPatch, RunState, RunStore, TaskRun } from '../ports.js';
const columns = `id, unit, request_id AS requestId, request_key AS requestKey, session_id AS sessionId,
 worktree, base_revision AS baseRevision, state, pane, tab, invocation, session_file AS sessionFile,
 created_at AS createdAt, updated_at AS updatedAt, detail`;
export function sqliteRunStore(db: Database.Database): RunStore {
  const get = (id: string): TaskRun => {
    const row = db.prepare('SELECT ' + columns + ' FROM task_runs WHERE id = ?').get(id) as TaskRun | undefined;
    if (!row) throw new Error('Unknown run');
    return row;
  };
  return {
    transaction: fn => db.transaction(fn).immediate(), get,
    list: id => db.prepare('SELECT ' + columns + ' FROM task_runs WHERE request_id = ? ORDER BY created_at,id').all(id) as TaskRun[],
    insert(run: TaskRun) {
      db.prepare(`INSERT INTO task_runs(id,unit,request_id,request_key,session_id,worktree,base_revision,state,
        pane,tab,invocation,session_file,created_at,updated_at,detail)
        VALUES (@id,@unit,@requestId,@requestKey,@sessionId,@worktree,@baseRevision,@state,
        @pane,@tab,@invocation,@sessionFile,@createdAt,@updatedAt,@detail)`).run(run);
    },
    update(id: string, state: RunState, at: string, patch: RunPatch) {
      const after = { ...get(id), ...patch, state, updatedAt: at };
      db.prepare(`UPDATE task_runs SET state=@state,pane=@pane,tab=@tab,invocation=@invocation,
        session_file=@sessionFile,updated_at=@updatedAt,detail=@detail WHERE id=@id`).run(after);
      return get(id);
    },
  };
}
