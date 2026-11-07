import Database from 'better-sqlite3';
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { connect } from './database.js';

export const ARCHIVE_SCHEMA_VERSION = 1;

function version(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

export function initializeArchive(filename: string): void {
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  closeSync(openSync(filename, 'a', 0o600));
  const db = connect(filename, false, true);
  try {
    if (version(db) > ARCHIVE_SCHEMA_VERSION) throw new Error('Archive schema is newer than this application');
    if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') throw new Error('Could not enable SQLite WAL');
    db.transaction(() => {
      const current = version(db);
      if (current > ARCHIVE_SCHEMA_VERSION) throw new Error('Archive schema is newer than this application');
      if (current < 1) {
        db.exec(readFileSync(new URL('./archive-migrations/001-archive.sql', import.meta.url), 'utf8'));
        db.pragma('user_version = 1');
      }
    }).immediate();
    chmodSync(filename, 0o600);
  } finally {
    db.close();
  }
}

export function openArchive(filename: string, readonly = false): Database.Database {
  const db = connect(filename, readonly, true);
  try {
    if (version(db) !== ARCHIVE_SCHEMA_VERSION) throw new Error('Archive schema does not match this application');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
