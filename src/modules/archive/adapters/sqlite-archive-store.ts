import type { Database } from 'better-sqlite3';
import type { ArchiveAgent, ArchiveCounts, ArchiveSession, ArchiveStore, KeySource } from '../ports.js';
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
    counts() {
      const counts: ArchiveCounts = { sessions: { claude: 0, pi: 0 }, messages: { claude: 0, pi: 0 }, boundSessions: 0, unboundSessions: 0, keys: 0,
        keySources: { sessions: 0, name: 0 } };
      let total = 0;
      for (const r of db.prepare('SELECT agent, count(*) AS sessions, count(key) AS bound FROM archive_sessions GROUP BY agent').all() as
        { agent: ArchiveAgent; sessions: number; bound: number }[]) {
        counts.sessions[r.agent] = r.sessions;
        counts.boundSessions += r.bound;
        total += r.sessions;
      }
      counts.unboundSessions = total - counts.boundSessions;
      for (const r of db.prepare('SELECT agent, count(*) AS messages FROM archive_messages GROUP BY agent').all() as
        { agent: ArchiveAgent; messages: number }[]) counts.messages[r.agent] = r.messages;
      counts.keys = (db.prepare('SELECT count(DISTINCT key) AS keys FROM archive_sessions').get() as { keys: number }).keys;
      for (const r of db.prepare('SELECT key_source AS source, count(*) AS n FROM archive_sessions WHERE key_source IS NOT NULL GROUP BY key_source').all() as
        { source: KeySource; n: number }[]) counts.keySources[r.source] = r.n;
      return counts;
    },
  };
}
