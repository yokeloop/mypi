import { openDatabase } from '../infrastructure/database/database.js';
import { externalDatabasePath } from '../infrastructure/filesystem/paths.js';
import { engineRoot } from './create-app.js';

export function createChangeFeed(filename: string) {
  const db = openDatabase(externalDatabasePath(filename, engineRoot()), true);
  let seen = db.pragma('data_version', { simple: true }) as number, changeId = 1;
  return {
    changeId: () => changeId,
    poll(): boolean {
      const now = db.pragma('data_version', { simple: true }) as number;
      if (now === seen) return false;
      seen = now; changeId += 1; return true;
    },
    close: () => db.close(),
  };
}
