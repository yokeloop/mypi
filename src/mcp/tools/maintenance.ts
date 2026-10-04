import { z } from 'zod';
import { text, externalPath } from '../schemas.js';
export const maintenance = {
  context_read: { schema: z.strictObject({ path: text }), description: 'Read UTF-8 file relative to context home, subject to path guards. Not arbitrary filesystem access.' },
  context_commit: { schema: z.strictObject({ paths: z.array(text).min(1), message: text }), description: 'After reconciliation commit only named context files, not directories or engine code. No push.' },
  context_restore: { schema: z.strictObject({ path: text, revision: text }), description: 'Restore mutable context file from full Git SHA in a new commit. Immutable source/history protected.' },
  db_init: { schema: z.strictObject({}), description: 'Explicit administrative action: initialize/migrate DB only, never implicit on connection.' },
  bootstrap: { schema: z.strictObject({}), description: 'Explicit engineer intent required: initialize DB and separate context Git. Stop other writers first. No network.' },
  backup: { schema: z.strictObject({ destination: externalPath }), description: 'Write DB snapshot, context bundle and checksum manifest to a new directory. Not read-only.' },
  restore: { schema: z.strictObject({ backupDirectory: externalPath }), description: 'Explicit engineer intent required: restore into absent DB/home of THIS installation. Stop other writers first. Never overwrite existing state.' },
};
