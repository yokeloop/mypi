import { createApp } from '../../src/app/create-app.js';
import { openDatabase } from '../../src/infrastructure/database/database.js';
import type { Project } from '../../src/modules/projects/public.js';

export function seedRepository(filename: string, code: string, repository: null | 'local'): Project {
  const db = openDatabase(filename);
  try {
    const { changes } = db.prepare('UPDATE projects SET repository = ? WHERE code = ?').run(repository, code);
    if (changes !== 1) throw new Error('seedRepository: no project ' + code);
  } finally { db.close(); }
  const read = createApp(filename, true);
  try { return read.projects.list().find(p => p.code === code)!; } finally { read.close(); }
}
