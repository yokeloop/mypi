// Composition entry for storage-only consumers (no Git subprocess dependency).
import type { Database } from 'better-sqlite3';
import { publishedArtifacts, sqliteJournalStore } from '../modules/knowledge/public.js';
export { sqliteJournalStore as journalStorage };
export const publishedArtifactPaths = (db: Database) => publishedArtifacts(sqliteJournalStore(db));
