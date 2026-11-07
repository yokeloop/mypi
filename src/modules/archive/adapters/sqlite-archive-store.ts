import type { Database } from 'better-sqlite3';
import type { ArchiveAgent, ArchiveSession, ArchiveStore } from '../ports.js';
export function sqliteArchiveStore(db: Database): ArchiveStore {
  return {
    transaction: fn => db.readonly ? db.transaction(fn)() : db.transaction(fn).immediate(),
    session: (agent: ArchiveAgent, nativeId: string) => db.prepare(`SELECT agent, native_id AS nativeId, path, cwd, key, key_source AS keySource,
      parent_native_id AS parentNativeId, first_at AS firstAt, last_at AS lastAt, bytes_read AS bytesRead, updated_at AS updatedAt
      FROM archive_sessions WHERE agent = ? AND native_id = ?`).get(agent, nativeId) as ArchiveSession | undefined,
    saveSession(row) {
      db.prepare(`INSERT INTO archive_sessions(agent, native_id, path, cwd, key, key_source, parent_native_id, first_at, last_at, bytes_read, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(agent, native_id) DO UPDATE SET path=excluded.path, cwd=excluded.cwd, key=excluded.key,
        key_source=excluded.key_source, parent_native_id=excluded.parent_native_id, first_at=excluded.first_at, last_at=excluded.last_at,
        bytes_read=excluded.bytes_read, updated_at=excluded.updated_at`)
        .run(row.agent, row.nativeId, row.path, row.cwd, row.key, row.keySource, row.parentNativeId, row.firstAt, row.lastAt, row.bytesRead, row.updatedAt);
    },
    insertMessages(agent, nativeId, entries) {
      const insert = db.prepare(`INSERT OR IGNORE INTO archive_messages(agent, native_id, entry_id, parent_entry_id, at, role, origin, text)
        VALUES (?,?,?,?,?,?,?,?)`);
      let inserted = 0;
      for (const e of entries) inserted += insert.run(agent, nativeId, e.entryId, e.parentEntryId, e.at, e.role, e.origin, e.text).changes;
      return inserted;
    },
  };
}
