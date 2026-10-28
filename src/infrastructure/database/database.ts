import Database from 'better-sqlite3';
import { chmodSync, mkdirSync, readFileSync, openSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';

const schemaVersion = 8;

function connect(filename: string, readonly: boolean, fileMustExist: boolean): Database.Database {
  const db = new Database(filename, { readonly, fileMustExist, timeout: 1000 });
  try {
    db.pragma('foreign_keys = ON');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function version(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

export function initializeDatabase(filename: string, createOnly = false): void {
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  // Interactive setup must not open/migrate a database created after its preview.
  if (createOnly) closeSync(openSync(filename, 'wx', 0o600));
  const db = connect(filename, false, false);
  try {
    const current = version(db);
    if (current > schemaVersion) throw new Error('Database schema is newer than this application');
    // SQLite cannot change journal mode inside a transaction. Only explicit init/upgrade
    // switches mode; ordinary opens, including readonly reads, never configure it.
    if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') throw new Error('Could not enable SQLite WAL');
    db.transaction(() => {
      const current = version(db);
      if (current > schemaVersion) throw new Error('Database schema is newer than this application');
      if (current === 0) {
        db.exec(readFileSync(new URL('./migrations/001-initial.sql', import.meta.url), 'utf8'));
        db.pragma('user_version = 1');
      }
      if (current < 2) {
        db.exec(readFileSync(new URL('./migrations/002-knowledge-journal.sql', import.meta.url), 'utf8'));
        db.pragma('user_version = 2');
      }
      if (current < 3) {
        db.exec(readFileSync(new URL('./migrations/003-work-chats.sql', import.meta.url), 'utf8'));
        db.pragma('user_version = 3');
      }
      if (current < 4) {
        db.exec(readFileSync(new URL('./migrations/004-work-chat-auth-pending.sql', import.meta.url), 'utf8'));
        db.pragma('user_version = 4');
      }
      if (current < 5) {
        db.exec(readFileSync(new URL('./migrations/005-work-chat-process-origin.sql', import.meta.url), 'utf8'));
        db.pragma('user_version = 5');
      }
      if (current < 6) {
        db.exec(readFileSync(new URL('./migrations/006-drop-work-chats.sql', import.meta.url), 'utf8'));
        db.pragma('user_version = 6');
      }
      if (current < 7) {
        db.exec(readFileSync(new URL('./migrations/007-rename-requests-tasks.sql', import.meta.url), 'utf8'));
        db.pragma('user_version = 7');
      }
      if (current < 8) {
        db.exec(readFileSync(new URL('./migrations/008-sessions-events.sql', import.meta.url), 'utf8'));
        db.pragma('user_version = 8');
      }
    }).immediate();
    chmodSync(filename, 0o600);
  } finally {
    db.close();
  }
}

export function openDatabase(filename: string, readonly = false): Database.Database {
  const db = connect(filename, readonly, true);
  try {
    if (version(db) !== schemaVersion) throw new Error('Run db init with a compatible application before use');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
