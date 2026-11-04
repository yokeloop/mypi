import type { Database } from 'better-sqlite3';
import type { EventRow, EventStore } from '../ports.js';
const select = `SELECT id, from_key AS fromKey, to_key AS toKey, kind, message, created_at AS createdAt, delivered_at AS deliveredAt FROM events`;
export function sqliteEventStore(db: Database): EventStore {
  return {
    transaction: fn => db.readonly ? db.transaction(fn)() : db.transaction(fn).immediate(),
    add: row => Number(db.prepare('INSERT INTO events(from_key,to_key,kind,message,created_at,delivered_at) VALUES (?,?,?,?,?,NULL)')
      .run(row.fromKey, row.toKey, row.kind, row.message, row.createdAt).lastInsertRowid),
    pending: toKey => (toKey === null
      ? db.prepare(select + ' WHERE delivered_at IS NULL ORDER BY id').all()
      : db.prepare(select + ' WHERE delivered_at IS NULL AND to_key = ? ORDER BY id').all(toKey)) as EventRow[],
    lastDelivered: toKey => db.prepare(select + ` WHERE id IN (SELECT max(id) FROM events WHERE to_key = ? AND delivered_at IS NOT NULL
      AND kind = 'turn_end' GROUP BY from_key) ORDER BY id`).all(toKey) as EventRow[],
    lastMessageSender: toKey => (db.prepare(`SELECT from_key AS fromKey FROM events WHERE to_key = ? AND kind = 'message'
      ORDER BY id DESC LIMIT 1`).get(toKey) as { fromKey: string } | undefined)?.fromKey,
    deliver(ids, at) {
      const update = db.prepare('UPDATE events SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL');
      for (const id of ids) update.run(at, id);
    },
    browse: filter => {
      const to = filter.to ?? null, from = filter.from ?? null, kind = filter.kind ?? null, before = filter.before ?? null;
      const delivered = filter.delivered === undefined ? '' : filter.delivered ? ' AND delivered_at IS NOT NULL' : ' AND delivered_at IS NULL';
      return db.prepare(select + ` WHERE (? IS NULL OR to_key = ?) AND (? IS NULL OR from_key = ?) AND (? IS NULL OR kind = ?)
        AND (? IS NULL OR id < ?)` + delivered + ' ORDER BY id DESC').iterate(to, to, from, from, kind, kind, before, before) as Iterable<EventRow>;
    },
  };
}
