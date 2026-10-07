import Database from 'better-sqlite3';
import { chmodSync, mkdirSync, readFileSync, openSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';

const schemaVersion = 1;

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
    db.transaction(() => {
      const current = version(db);
      if (current > schemaVersion) throw new Error('Database schema is newer than this application');
      if (current === 0) {
        db.exec(readFileSync(new URL('./migrations/001-initial.sql', import.meta.url), 'utf8'));
        db.pragma('user_version = 1');
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
