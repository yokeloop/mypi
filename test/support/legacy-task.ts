import { openDatabase } from '../../src/infrastructure/database/database.js';
import { contextFiles } from '../../src/infrastructure/filesystem/context-files.js';
import { sqliteJournalStore } from '../../src/modules/knowledge/public.js';
import { fileFingerprint } from '../../src/app/file-fingerprints.js';

export function legacyTask(filename: string, root: string, number: number, slug: string, at = '2026-01-01T00:00:00.000Z'): { key: string; contextDir: string } {
  const contextDir = 'requests/REQ-' + number + '-' + slug;
  contextFiles(root).create(contextDir + '/source.md', 'legacy ' + slug);
  const db = openDatabase(filename);
  try {
    db.prepare(`INSERT INTO tasks(project_id, number, title, status_id, context_dir, created_at, updated_at)
      VALUES (NULL, ?, 'Legacy', (SELECT id FROM task_statuses WHERE code = 'new'), ?, ?, ?)`).run(number, contextDir, at, at);
    sqliteJournalStore(db).saveFingerprint(fileFingerprint(contextFiles(root), contextDir + '/source.md', at));
  } finally { db.close(); }
  return { key: 'REQ-' + number, contextDir };
}
