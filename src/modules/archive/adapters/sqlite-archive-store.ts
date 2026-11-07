import Sqlite, { type Database } from 'better-sqlite3';
import type { ArchiveAgent, ArchiveAnchor, ArchiveCounts, ArchiveFilter, ArchiveHit, ArchiveMessage, ArchiveSession, ArchiveSessionHits, ArchiveStore, KeySource } from '../ports.js';
import { InputError } from '../../../shared/errors.js';
const shown = "(m.origin = 'human' OR m.role = 'assistant')";
const joined = 'JOIN archive_sessions s ON s.agent = m.agent AND s.native_id = m.native_id';
function where(filter: ArchiveFilter): { sql: string; params: unknown[] } {
  const parts: string[] = [], params: unknown[] = [];
  if (!filter.includePeer) parts.push(shown);
  if (filter.keys !== null) {
    const keys: string[] = [];
    if (filter.keys.exact.length) { keys.push('s.key IN (' + filter.keys.exact.map(() => '?').join(',') + ')'); params.push(...filter.keys.exact); }
    for (const code of filter.keys.projects) { keys.push('s.key = ? OR s.key GLOB ?'); params.push(code, code + '-[1-9]*'); }
    parts.push(keys.length ? '(' + keys.join(' OR ') + ')' : '0');
  }
  if (filter.agent !== undefined) { parts.push('m.agent = ?'); params.push(filter.agent); }
  if (filter.from !== undefined) { parts.push('m.at >= ?'); params.push(filter.from); }
  if (filter.to !== undefined) { parts.push('m.at <= ?'); params.push(filter.to); }
  return { sql: parts.length ? parts.join(' AND ') : '1', params };
}
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
    search(match, filter, limit) {
      const w = where(filter);
      try {
        return db.prepare(`SELECT m.id, m.agent, s.key, m.native_id AS session, m.at, m.role, m.origin,
          snippet(archive_fts, 0, '[', ']', '…', 12) AS snippet FROM archive_fts JOIN archive_messages m ON m.id = archive_fts.rowid ${joined}
          WHERE archive_fts MATCH ? AND ${w.sql} ORDER BY bm25(archive_fts), m.id LIMIT ?`).all(match, ...w.params, limit) as ArchiveHit[];
      } catch (error) {
        if (error instanceof Sqlite.SqliteError) throw new InputError('Invalid search query: ' + error.message);
        throw error;
      }
    },
    sessionList(filter, limit) {
      const w = where(filter);
      return db.prepare(`SELECT s.agent, s.native_id AS session, s.key, min(m.at) AS firstAt, max(m.at) AS lastAt, count(*) AS messages
        FROM archive_messages m ${joined} WHERE ${w.sql} GROUP BY s.id ORDER BY lastAt DESC, s.id DESC LIMIT ?`).all(...w.params, limit) as ArchiveSessionHits[];
    },
    message: id => db.prepare('SELECT id, agent, native_id AS session, at, role, origin, text FROM archive_messages WHERE id = ?').get(id) as ArchiveAnchor | undefined,
    around(anchor, before, after, includePeer) {
      const peer = includePeer ? '' : ' AND ' + shown;
      const earlier = db.prepare(`SELECT id, at, role, origin, text FROM archive_messages m WHERE agent = ? AND native_id = ?
        AND (at < ? OR (at = ? AND id < ?))${peer} ORDER BY at DESC, id DESC LIMIT ?`)
        .all(anchor.agent, anchor.session, anchor.at, anchor.at, anchor.id, before) as ArchiveMessage[];
      const later = db.prepare(`SELECT id, at, role, origin, text FROM archive_messages m WHERE agent = ? AND native_id = ?
        AND (at > ? OR (at = ? AND id > ?))${peer} ORDER BY at, id LIMIT ?`)
        .all(anchor.agent, anchor.session, anchor.at, anchor.at, anchor.id, after) as ArchiveMessage[];
      return { before: earlier.reverse(), after: later };
    },
    agentsOf: nativeId => (db.prepare('SELECT agent FROM archive_sessions WHERE native_id = ? ORDER BY agent').all(nativeId) as
      { agent: ArchiveAgent }[]).map(r => r.agent),
    page(agent, nativeId, offset, limit, includePeer) {
      const peer = includePeer ? '' : ' AND ' + shown;
      const messages = db.prepare(`SELECT id, at, role, origin, text FROM archive_messages m WHERE agent = ? AND native_id = ?${peer}
        ORDER BY at, id LIMIT ? OFFSET ?`).all(agent, nativeId, limit, offset) as ArchiveMessage[];
      const { total } = db.prepare(`SELECT count(*) AS total FROM archive_messages m WHERE agent = ? AND native_id = ?${peer}`)
        .get(agent, nativeId) as { total: number };
      return { messages, total };
    },
  };
}
