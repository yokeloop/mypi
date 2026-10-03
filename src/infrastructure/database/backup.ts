import { existsSync, copyFileSync, chmodSync, constants } from 'node:fs';
import { openDatabase } from './database.js';

export async function snapshotDatabase(source: string, destination: string): Promise<void> {
  if (existsSync(destination)) throw new Error('Backup destination exists');
  const db = openDatabase(source, true);
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Corrupt database');
    await db.backup(destination);
    chmodSync(destination, 0o600);
  } finally { db.close(); }
}
export async function withWriteLock<T>(filename: string, work: () => Promise<T>): Promise<T> {
  const db = openDatabase(filename);
  try { db.exec('BEGIN IMMEDIATE'); return await work(); }
  finally { if (db.inTransaction) db.exec('ROLLBACK'); db.close(); }
}
export function restoreDatabase(source: string, destination: string): void {
  const db = openDatabase(source, true);
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Corrupt database');
  } finally { db.close(); }
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
  chmodSync(destination, 0o600);
}
